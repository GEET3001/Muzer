import { NextResponse } from "next/server";
import { getCurrentUser } from "@/app/lib/auth";
import { isHost } from "@/app/lib/access";

// Host-only: report whether the current user has linked a Razorpay Route account
// and whether payouts are live yet. Reads DB fields only (no Razorpay call), so
// it works before any keys are configured. The dashboard's "Refresh status"
// button polls this.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  if (!(await isHost(user.id))) {
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
