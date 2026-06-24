import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prismaClient } from "@/app/lib/db";
import { authOptions } from "@/app/lib/auth";
import { getServerSession } from "next-auth";
import { isParticipant } from "@/app/lib/access";
import { cacheGet, cacheSet, rateLimit, publishQueueChanged } from "@/app/lib/redis";
import youtubesearchapi from "youtube-search-api";

const YT_REGEX =
  /^(?:(?:https?:)?\/\/)?(?:www\.)?(?:m\.)?(?:youtu(?:be)?\.com\/(?:v\/|embed\/|watch(?:\/|\?v=))|youtu\.be\/)((?:\w|-){11})(?:\S+)?$/;

const CreateStreamSchema = z.object({
  url: z.string().min(1, "url is required"),
  sessionCode: z.string().min(1, "sessionCode is required"),
});

type VideoMeta = { title: string; smallImg: string; bigImg: string };

// Look up (and cache) YouTube metadata for a video id. Always resolves — falls
// back to the CDN thumbnail + a placeholder title if the lookup fails.
async function getVideoMeta(extractedId: string): Promise<VideoMeta> {
  const fallbackThumb = `https://img.youtube.com/vi/${extractedId}/hqdefault.jpg`;
  const fallback: VideoMeta = {
    title: "Untitled track",
    smallImg: fallbackThumb,
    bigImg: fallbackThumb,
  };

  const cached = await cacheGet<VideoMeta>(`yt:${extractedId}`);
  if (cached) return cached;

  try {
    const res = await youtubesearchapi.GetVideoDetails(extractedId);
    const meta: VideoMeta = { ...fallback };
    if (res?.title) meta.title = res.title;

    const thumbnails: { url: string; width: number }[] =
      res?.thumbnail?.thumbnails ?? [];
    if (thumbnails.length > 0) {
      thumbnails.sort((a, b) => a.width - b.width);
      meta.bigImg = thumbnails[thumbnails.length - 1].url ?? fallbackThumb;
      meta.smallImg =
        thumbnails.length > 1
          ? thumbnails[thumbnails.length - 2].url ?? fallbackThumb
          : meta.bigImg;
    }

    // Cache for an hour — titles/thumbnails for a given id are effectively static.
    await cacheSet(`yt:${extractedId}`, meta, 3600);
    return meta;
  } catch {
    // Metadata lookup failed — keep the CDN fallbacks and still queue the song.
    return fallback;
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const authedUser = await prismaClient.user.findUnique({
      where: { email: session.user.email },
    });
    if (!authedUser) {
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

    // Throttle track spam: 20 adds / minute per user.
    if (!(await rateLimit(`add:${authedUser.id}`, 20, 60))) {
      return NextResponse.json(
        { message: "Slow down — too many tracks added" },
        { status: 429 }
      );
    }

    const parsed = CreateStreamSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { message: "Invalid request body" },
        { status: 400 }
      );
    }
    const data = parsed.data;

    const match = data.url.match(YT_REGEX);
    // Group 1 is the canonical 11-char video id regardless of URL shape
    // (watch?v=, youtu.be/, embed/, ...). Never derive it via split("?v=").
    const extractedId = match?.[1];
    if (!extractedId) {
      return NextResponse.json(
        { message: "Invalid YouTube URL" },
        { status: 400 }
      );
    }

    const foundSession = await prismaClient.session.findUnique({
      where: { code: data.sessionCode },
    });
    if (!foundSession) {
      return NextResponse.json({ message: "Invalid session" }, { status: 404 });
    }

    // Only host/joined members (two-code auth) may add tracks.
    if (!(await isParticipant(authedUser.id, foundSession))) {
      return NextResponse.json(
        { message: "Join this stream to add tracks" },
        { status: 403 }
      );
    }

    // Avoid stacking the exact same track twice in one session.
    const duplicate = await prismaClient.stream.findFirst({
      where: { sessionId: foundSession.id, extractedId },
    });
    if (duplicate) {
      return NextResponse.json(
        { message: "This track is already in the queue" },
        { status: 409 }
      );
    }

    const meta = await getVideoMeta(extractedId);

    const stream = await prismaClient.stream.create({
      data: {
        userId: foundSession.hostId,
        addedById: authedUser.id,
        sessionId: foundSession.id,
        url: data.url,
        extractedId,
        type: "Youtube",
        title: meta.title,
        smallImg: meta.smallImg,
        bigImg: meta.bigImg,
      },
    });

    await publishQueueChanged(foundSession.code);
    return NextResponse.json({ message: "Added Stream", id: stream.id });
  } catch (e) {
    console.error("POST /api/streams failed:", e);
    return NextResponse.json(
      { message: "Error while adding a stream" },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.json({ message: "code required" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }
  const user = await prismaClient.user.findUnique({
    where: { email: session.user.email },
  });
  if (!user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const foundSession = await prismaClient.session.findUnique({
    where: { code },
  });
  if (!foundSession) {
    return NextResponse.json({ message: "Invalid session" }, { status: 404 });
  }

  // Gate the queue behind two-code membership.
  if (!(await isParticipant(user.id, foundSession))) {
    return NextResponse.json({ message: "Join this stream first" }, { status: 403 });
  }

  const streams = await prismaClient.stream.findMany({
    where: { sessionId: foundSession.id },
    include: { upvotes: true },
    orderBy: { createdAt: "asc" },
  });

  const items = streams
    .map((s) => ({
      id: s.id,
      url: s.url,
      title: s.title,
      smallImg: s.smallImg,
      bigImg: s.bigImg,
      extractedId: s.extractedId,
      // Net score = sum of signed votes (+1 up, -1 down).
      upvotes: s.upvotes.reduce((sum, v) => sum + v.value, 0),
      // This caller's own vote, so the UI can highlight up/down: 1 | -1 | 0.
      myVote: s.upvotes.find((v) => v.userId === user.id)?.value ?? 0,
    }))
    // Highest score first; ties keep insertion order (stable sort).
    .sort((a, b) => b.upvotes - a.upvotes);

  return NextResponse.json({ items });
}

const DeleteStreamSchema = z.object({
  streamId: z.string().min(1),
});

// Host-only: remove a track from the queue (used to advance "Now Playing").
export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const user = await prismaClient.user.findUnique({
      where: { email: session.user.email },
    });
    if (!user) {
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

    const parsed = DeleteStreamSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { message: "streamId is required" },
        { status: 400 }
      );
    }

    const stream = await prismaClient.stream.findUnique({
      where: { id: parsed.data.streamId },
      include: { session: true },
    });
    if (!stream) {
      return NextResponse.json({ message: "Stream not found" }, { status: 404 });
    }

    // Only the session host may control the deck.
    if (!stream.session || stream.session.hostId !== user.id) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    // Upvotes reference the stream, so clear them first to satisfy the FK.
    await prismaClient.$transaction([
      prismaClient.upvotes.deleteMany({ where: { streamId: stream.id } }),
      prismaClient.stream.delete({ where: { id: stream.id } }),
    ]);

    await publishQueueChanged(stream.session.code);
    return NextResponse.json({ message: "Stream removed" });
  } catch (e) {
    console.error("DELETE /api/streams failed:", e);
    return NextResponse.json(
      { message: "Error while removing stream" },
      { status: 500 }
    );
  }
}
