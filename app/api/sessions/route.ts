import { NextResponse } from "next/server";
import { prismaClient } from "@/app/lib/db";
import { getServerSession } from "next-auth";

// Join code: easy to read aloud, no ambiguous chars (no 0/O/1/I).
function generateJoinCode(length = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Access code: numeric PIN, the second factor for joining.
function generateAccessCode(length = 6) {
  let result = "";
  for (let i = 0; i < length; i++) {
    result += Math.floor(Math.random() * 10).toString();
  }
  return result;
}

async function requireUser() {
  const session = await getServerSession();
  if (!session?.user?.email) return null;
  return prismaClient.user.findUnique({ where: { email: session.user.email } });
}

// Returns the host's most recent session (with both codes) so the dashboard
// can show credentials without re-creating a room on every reload.
export async function GET() {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const existing = await prismaClient.session.findFirst({
    where: { hostId: user.id },
    orderBy: { createdAt: "desc" },
  });

  if (!existing) return NextResponse.json({ session: null });

  return NextResponse.json({
    code: existing.code,
    accessCode: existing.accessCode,
  });
}

export async function POST() {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
