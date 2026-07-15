import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/lib/auth";
import { prismaClient } from "@/app/lib/db";

// Host-only: report whether the current user has linked a Razorpay Route account
// and whether payouts are live yet. Reads DB fields only (no Razorpay call), so
// it works before any keys are configured. The dashboard's "Refresh status"
// button polls this.
export async function GET() {
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

  // Only hosts (users who run at least one session) set up payouts.
  const hostsASession = await prismaClient.session.findFirst({
    where: { hostId: user.id },
    select: { id: true },
  });
  if (!hostsASession) {
    return NextResponse.json(
      { message: "Only hosts can set up payments" },
      { status: 403 }
    );
  }

  return NextResponse.json({
    linked: Boolean(user.razorpayAccountId),
    payoutsEnabled: user.razorpayPayoutsEnabled,
  });
}
