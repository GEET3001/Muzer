import { prismaClient } from "@/app/lib/db";
import { authOptions } from "@/app/lib/auth";
import { isParticipant } from "@/app/lib/access";
import { rateLimit, publishQueueChanged } from "@/app/lib/redis";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const UpvoteSchema = z.object({
  streamId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ message: "unauthenticated" }, { status: 401 });
  }

  const user = await prismaClient.user.findUnique({
    where: { email: session.user.email },
  });
  if (!user) {
    return NextResponse.json({ message: "unauthenticated" }, { status: 401 });
  }

  // Throttle vote spam: 60 votes / minute per user.
  if (!(await rateLimit(`vote:${user.id}`, 60, 60))) {
    return NextResponse.json(
      { message: "Slow down — too many votes" },
      { status: 429 }
    );
  }

  const parsed = UpvoteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "streamId is required" }, { status: 400 });
  }

  // Only participants of the track's session may vote (two-code auth).
  const stream = await prismaClient.stream.findUnique({
    where: { id: parsed.data.streamId },
    include: { session: true },
  });
  if (!stream) {
    return NextResponse.json({ message: "Stream not found" }, { status: 404 });
  }
  if (!stream.session || !(await isParticipant(user.id, stream.session))) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }

  try {
    // One vote per user per stream. Clicking upvote when an upvote already
    // exists toggles it off; otherwise it sets/flips the vote to +1.
    const existing = await prismaClient.upvotes.findUnique({
      where: {
        userId_streamId: { userId: user.id, streamId: parsed.data.streamId },
      },
    });

    if (existing?.value === 1) {
      await prismaClient.upvotes.delete({ where: { id: existing.id } });
      await publishQueueChanged(stream.session.code);
      return NextResponse.json({ message: "vote removed", myVote: 0 });
    }

    await prismaClient.upvotes.upsert({
      where: {
        userId_streamId: { userId: user.id, streamId: parsed.data.streamId },
      },
      update: { value: 1 },
      create: { userId: user.id, streamId: parsed.data.streamId, value: 1 },
    });

    await publishQueueChanged(stream.session.code);
    return NextResponse.json({ message: "upvoted successfully", myVote: 1 });
  } catch (e) {
    console.error("POST /api/streams/upvote failed:", e);
    return NextResponse.json({ message: "error while upvoting" }, { status: 500 });
  }
}
