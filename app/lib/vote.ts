import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prismaClient } from "@/app/lib/db";
import { getCurrentUser } from "@/app/lib/auth";
import { isParticipant } from "@/app/lib/access";
import { rateLimit, publishQueueChanged } from "@/app/lib/redis";

const VoteSchema = z.object({
  streamId: z.string().min(1),
});

/**
 * Shared implementation behind POST /api/streams/upvote and .../downvote, which
 * are the same handler with the sign flipped. One vote per user per stream
 * (enforced by the composite unique on Upvotes): casting the vote you already
 * hold toggles it off, anything else sets or flips it.
 *
 * Bids are deliberately not touched here — paid position lives on the Stream row
 * and only the Razorpay webhook moves it.
 */
export async function castVote(
  req: NextRequest,
  value: 1 | -1,
  labels: { route: string; cast: string; verb: string }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: "unauthenticated" }, { status: 401 });
  }

  // Throttle vote spam: 60 votes / minute per user, shared across both
  // directions so flip-flopping can't double the budget.
  if (!(await rateLimit(`vote:${user.id}`, 60, 60))) {
    return NextResponse.json(
      { message: "Slow down — too many votes" },
      { status: 429 }
    );
  }

  const parsed = VoteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "streamId is required" }, { status: 400 });
  }
  const { streamId } = parsed.data;

  // Only participants of the track's session may vote (two-code auth).
  const stream = await prismaClient.stream.findUnique({
    where: { id: streamId },
    include: { session: true },
  });
  if (!stream) {
    return NextResponse.json({ message: "Stream not found" }, { status: 404 });
  }
  if (!stream.session || !(await isParticipant(user.id, stream.session))) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }
  const code = stream.session.code;

  try {
    const where = { userId_streamId: { userId: user.id, streamId } };
    const existing = await prismaClient.upvotes.findUnique({ where });

    if (existing?.value === value) {
      await prismaClient.upvotes.delete({ where: { id: existing.id } });
      await publishQueueChanged(code);
      return NextResponse.json({ message: "vote removed", myVote: 0 });
    }

    await prismaClient.upvotes.upsert({
      where,
      update: { value },
      create: { userId: user.id, streamId, value },
    });

    await publishQueueChanged(code);
    return NextResponse.json({ message: labels.cast, myVote: value });
  } catch (e) {
    console.error(`POST ${labels.route} failed:`, e);
    return NextResponse.json(
      { message: `error while ${labels.verb}` },
      { status: 500 }
    );
  }
}
