import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prismaClient } from "@/app/lib/db";
import { authOptions } from "@/app/lib/auth";
import { getServerSession } from "next-auth";
import { isParticipant } from "@/app/lib/access";
import { cacheGet, cacheSet, rateLimit, publishQueueChanged } from "@/app/lib/redis";
import { fetchVideoMeta, type VideoMeta } from "@/app/lib/youtube";

const YT_REGEX =
  /^(?:(?:https?:)?\/\/)?(?:www\.)?(?:m\.)?(?:youtu(?:be)?\.com\/(?:v\/|embed\/|watch(?:\/|\?v=))|youtu\.be\/)((?:\w|-){11})(?:\S+)?$/;

const CreateStreamSchema = z.object({
  url: z.string().min(1, "url is required"),
  sessionCode: z.string().min(1, "sessionCode is required"),
});

// Look up (and cache) YouTube metadata for a video id. Always resolves — the
// underlying fetch falls back to the CDN thumbnail + a placeholder title if the
// lookup fails (see fetchVideoMeta).
async function getVideoMeta(extractedId: string): Promise<VideoMeta> {
  const cached = await cacheGet<VideoMeta>(`yt:${extractedId}`);
  if (cached) return cached;

  const meta = await fetchVideoMeta(extractedId);

  // Don't cache a failed lookup (placeholder title) — retry it next time.
  if (meta.title !== "Untitled track") {
    // Cache for an hour — titles/thumbnails for a given id are effectively static.
    await cacheSet(`yt:${extractedId}`, meta, 3600);
  }
  return meta;
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
    include: {
      host: {
        select: { razorpayAccountId: true, razorpayPayoutsEnabled: true },
      },
    },
  });
  if (!foundSession) {
    return NextResponse.json({ message: "Invalid session" }, { status: 404 });
  }

  // Guests can only bid when the host's payouts are actually live — surfaced to
  // the client so the Bid button knows whether to offer a payment or a notice.
  const acceptsPayments = Boolean(
    foundSession.host.razorpayAccountId &&
      foundSession.host.razorpayPayoutsEnabled
  );

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
      // Cumulative paid bid in paise — the primary sort key (see below).
      bidAmountUnits: s.bidAmountUnits,
      // ISO timestamp — the client uses it as the vote tie-breaker and to keep
      // its optimistic re-sort identical to the server's ordering.
      createdAt: s.createdAt.toISOString(),
    }))
    // Highest paid bid first, then highest net score; ties broken by whoever was
    // added earlier (ISO strings compare chronologically). Explicit so it never
    // depends on sort stability. Mirrors sortQueue() in app/lib/queue.ts exactly.
    .sort(
      (a, b) =>
        b.bidAmountUnits - a.bidAmountUnits ||
        b.upvotes - a.upvotes ||
        (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0)
    );

  // Resolve the pinned "now playing" track. If the session has no current track
  // (fresh room, or the last one was played out) or it points at a track that no
  // longer exists, lock in the current top of the queue and persist it so votes
  // can't swap the playing song out from under everyone.
  let currentStreamId = foundSession.currentStreamId;
  const currentValid =
    currentStreamId && items.some((i) => i.id === currentStreamId);
  if (!currentValid) {
    currentStreamId = items[0]?.id ?? null;
    if (currentStreamId !== foundSession.currentStreamId) {
      await prismaClient.session.update({
        where: { id: foundSession.id },
        data: { currentStreamId },
      });
    }
  }

  return NextResponse.json({
    currentStreamId,
    items,
    host: { acceptsPayments },
  });
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
