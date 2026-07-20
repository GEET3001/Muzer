import { NextResponse } from "next/server";
import { getCurrentUser } from "@/app/lib/auth";
import { isHost } from "@/app/lib/access";
import { prismaClient } from "@/app/lib/db";
import { getRazorpay } from "@/app/lib/razorpay";

// Where a linked-account holder finishes KYC / activation. Razorpay's v2 Accounts
// API does not hand back a per-account hosted KYC link, so we point the host at
// their Razorpay dashboard. Swapping this for Razorpay Hosted Onboarding later
// won't change this endpoint's response contract. Activation status is not read
// from here — `razorpayPayoutsEnabled` flips via the Phase 3 `account.updated`
// webhook.
const ONBOARDING_URL = "https://dashboard.razorpay.com/app/route";

// Host-only: create (or return the existing) Razorpay Route linked account for
// the current host, so bid payouts can be routed to them. Idempotent — a host
// with an account already gets it back without a second Razorpay call.
export async function POST() {
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

  // Already linked — return it, don't create a duplicate on Razorpay's side.
  if (user.razorpayAccountId) {
    return NextResponse.json({
      razorpayAccountId: user.razorpayAccountId,
      onboardingUrl: ONBOARDING_URL,
    });
  }

  try {
    // Create the Route linked account (POST /v2/accounts, razorpay@2.9.x).
    // NOTE: the Route API requires business/contact details we don't collect in
    // this pass, so these are test-mode placeholders derived from the host. A
    // production flow must gather real KYC details via a form before this call.
    const account = await getRazorpay().accounts.create({
      email: user.email,
      phone: "9999999999",
      type: "route",
      legal_business_name: `Muzer Host ${user.id.slice(0, 8)}`,
      business_type: "individual",
      contact_name: user.email.split("@")[0] || "Muzer Host",
      profile: {
        category: "ecommerce",
        subcategory: "music",
        addresses: {
          registered: {
            street1: "1 Music Lane",
            street2: "Indiranagar",
            city: "Bengaluru",
            state: "Karnataka",
            postal_code: "560038",
            country: "IN",
          },
        },
      },
    });

    await prismaClient.user.update({
      where: { id: user.id },
      data: { razorpayAccountId: account.id },
    });

    return NextResponse.json({
      razorpayAccountId: account.id,
      onboardingUrl: ONBOARDING_URL,
    });
  } catch (e) {
    console.error("POST /api/host/payment/razorpay failed:", e);
    // Surface Razorpay's own error text when present so the host can act on it.
    const description =
      e && typeof e === "object" && "error" in e
        ? (e as { error?: { description?: string } }).error?.description
        : undefined;
    return NextResponse.json(
      { message: description ?? "Could not create the Razorpay linked account" },
      { status: 502 }
    );
  }
}
