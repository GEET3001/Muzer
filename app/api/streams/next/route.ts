import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/lib/auth";
import { prismaClient } from "@/app/lib/db";
import { publishQueueChanged } from "@/app/lib/redis";

const NextSchema = z.object({
  code: z.string().min(1),
});

// Host-only: advance the deck. Drops the currently-pinned track (it has played /
// been skipped) and pins the next top-voted one. This is the ONLY way the "now
// playing" song changes — votes can reorder the upcoming queue but never swap
// the current track. Called automatically when the host's player fires "ended",
// or manually via the host's Skip button.
export async function POST(req: NextRequest) {
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

  const parsed = NextSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "code is required" }, { status: 400 });
  }

  const foundSession = await prismaClient.session.findUnique({
    where: { code: parsed.data.code },
  });
  if (!foundSession) {
    return NextResponse.json({ message: "Invalid session" }, { status: 404 });
  }
  // Only the host controls the deck.
  if (foundSession.hostId !== user.id) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }

  try {
    const playedId = foundSession.currentStreamId;

    // Remove the track that just finished (and its votes) if it still exists.
    if (playedId) {
      await prismaClient.$transaction([
        prismaClient.upvotes.deleteMany({ where: { streamId: playedId } }),
        prismaClient.stream.deleteMany({
          where: { id: playedId, sessionId: foundSession.id },
        }),
      ]);
    }

    // Pick the next track: highest paid bid first, then highest net votes, ties
    // broken by earliest added. Comparator is explicit (does NOT rely on JS sort
    // stability) and mirrors sortQueue() in app/lib/queue.ts exactly.
    const remaining = await prismaClient.stream.findMany({
      where: { sessionId: foundSession.id },
      include: { upvotes: true },
      orderBy: { createdAt: "asc" },
    });
    const ranked = remaining
      .map((s) => ({
        id: s.id,
        bidAmountUnits: s.bidAmountUnits,
        score: s.upvotes.reduce((sum, v) => sum + v.value, 0),
        createdAt: s.createdAt.toISOString(),
      }))
      .sort(
        (a, b) =>
          b.bidAmountUnits - a.bidAmountUnits ||
          b.score - a.score ||
          (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0)
      );
    const nextId = ranked[0]?.id ?? null;

    await prismaClient.session.update({
      where: { id: foundSession.id },
      data: { currentStreamId: nextId },
    });

    await publishQueueChanged(foundSession.code);
    return NextResponse.json({ currentStreamId: nextId });
  } catch (e) {
    console.error("POST /api/streams/next failed:", e);
    return NextResponse.json(
      { message: "Error advancing the deck" },
      { status: 500 }
    );
  }
}
