import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prismaClient } from "@/app/lib/db";
import { getServerSession } from "next-auth";

const JoinSchema = z.object({
  code: z.string().min(1, "Join code is required"),
  accessCode: z.string().min(1, "Access code is required"),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prismaClient.user.findUnique({
    where: { email: session.user.email },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const parsed = JoinSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Join code and access code are required" },
      { status: 400 }
    );
  }

  // Join codes are stored uppercase; accept any casing the user types.
  const code = parsed.data.code.trim().toUpperCase();
  const accessCode = parsed.data.accessCode.trim();

  const foundSession = await prismaClient.session.findUnique({
    where: { code },
  });

  // Two-code auth: both the room code AND the access code must match. Return
  // the same generic error for either failure so a wrong access code does not
  // confirm that a join code exists.
  if (!foundSession || foundSession.accessCode !== accessCode) {
    return NextResponse.json(
      { error: "Invalid join code or access code" },
      { status: 403 }
    );
  }

  // The host is already a participant; only add membership for guests.
  if (foundSession.hostId !== user.id) {
    await prismaClient.sessionMember.upsert({
      where: {
        sessionId_userId: { sessionId: foundSession.id, userId: user.id },
      },
      update: {},
      create: { sessionId: foundSession.id, userId: user.id },
    });
  }

  return NextResponse.json({ message: "Joined session", code: foundSession.code });
}
