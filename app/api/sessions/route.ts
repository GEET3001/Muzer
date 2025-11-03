import { NextRequest, NextResponse } from "next/server";
import { prismaClient } from "@/app/lib/db";
import { getServerSession } from "next-auth";
import { randomUUID } from "crypto";

function generateCode(length = 6) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prismaClient.user.findUnique({
    where: { email: session.user.email },
  });

  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  // Generate a unique code
  let code = generateCode();
  while (await prismaClient.session.findUnique({ where: { code } })) {
    code = generateCode();
  }

  const newSession = await prismaClient.session.create({
    data: {
      code,
      hostId: user.id,
    },
  });

  return NextResponse.json(newSession);
}
