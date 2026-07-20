import { NextRequest, NextResponse } from "next/server";
import { randomInt } from "crypto";
import { prismaClient } from "@/app/lib/db";
import { getCurrentUser } from "@/app/lib/auth";
import { publishQueueChanged } from "@/app/lib/redis";

// Join code: easy to read aloud, no ambiguous chars (no 0/O/1/I). Uses a CSPRNG
// (crypto.randomInt) so codes aren't predictable from Math.random's weak PRNG.
function generateJoinCode(length = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(randomInt(chars.length));
  }
  return result;
}

// Access code: numeric PIN, the second factor for joining. Also CSPRNG-backed.
function generateAccessCode(length = 6) {
  let result = "";
  for (let i = 0; i < length; i++) {
    result += randomInt(10).toString();
  }
  return result;
}

// The host's current room, if any. One room per host, so "most recent" is it.
function findHostRoom(hostId: string) {
  return prismaClient.session.findFirst({
    where: { hostId },
    orderBy: { createdAt: "desc" },
  });
}

// Returns the host's most recent session (with both codes) so the dashboard
// can show credentials without re-creating a room on every reload.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const existing = await findHostRoom(user.id);
  if (!existing) return NextResponse.json({ session: null });

  return NextResponse.json({
    code: existing.code,
    accessCode: existing.accessCode,
  });
}

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // One room at a time: if the host already has a session, return it instead of
  // creating another. This makes creation idempotent and keeps a single active
  // room per host (rotating codes is done via DELETE, which wipes the old one).
  const current = await findHostRoom(user.id);
  if (current) {
    return NextResponse.json({
      code: current.code,
      accessCode: current.accessCode,
    });
  }

  // Ensure the join code is globally unique.
  let code = generateJoinCode();
  while (await prismaClient.session.findUnique({ where: { code } })) {
    code = generateJoinCode();
  }

  const newSession = await prismaClient.session.create({
    data: {
      code,
      accessCode: generateAccessCode(),
      hostId: user.id,
    },
  });

  return NextResponse.json({
    code: newSession.code,
    accessCode: newSession.accessCode,
  });
}

// Host-only: disable a room. Because Muzer runs one room at a time, ending it
// should leave nothing behind — wipe every row tied to the session (votes,
// tracks, memberships, then the session itself) in a single transaction so the
// data is fully gone and FKs stay satisfied.
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Optional: a specific code. Default to the host's latest room.
  const body = await req.json().catch(() => ({}));
  const code: string | undefined =
    typeof body?.code === "string" ? body.code.trim().toUpperCase() : undefined;

  const target = code
    ? await prismaClient.session.findUnique({ where: { code } })
    : await findHostRoom(user.id);

  if (!target) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Only the host may disable their own room.
  if (target.hostId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Delete children before parents so the FKs stay satisfied. Votes are reached
  // through a relation filter rather than a pre-fetched id list — one round trip
  // instead of two, and no cap on how big the queue can be.
  await prismaClient.$transaction([
    prismaClient.upvotes.deleteMany({
      where: { stream: { sessionId: target.id } },
    }),
    prismaClient.stream.deleteMany({ where: { sessionId: target.id } }),
    prismaClient.sessionMember.deleteMany({ where: { sessionId: target.id } }),
    prismaClient.session.delete({ where: { id: target.id } }),
  ]);

  // Push the change so any guests still viewing the room refetch and see it end.
  await publishQueueChanged(target.code);
  return NextResponse.json({ message: "Session ended" });
}
