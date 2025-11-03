import { NextRequest, NextResponse } from "next/server";
import { prismaClient } from "@/app/lib/db";
import { getServerSession } from "next-auth";

export async function POST(req: NextRequest) {
  const { code } = await req.json();
  const session = await getServerSession();

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prismaClient.user.findUnique({
    where: { email: session.user.email },
  });

  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const foundSession = await prismaClient.session.findUnique({
    where: { code },
  });

  if (!foundSession) {
    return NextResponse.json({ error: "Invalid code" }, { status: 404 });
  }

  // Add user to session
  await prismaClient.sessionMember.upsert({
    where: { sessionId_userId: { sessionId: foundSession.id, userId: user.id } },
    update: {},
    create: { sessionId: foundSession.id, userId: user.id },
  });

  return NextResponse.json({ message: "Joined session", session: foundSession });
}
