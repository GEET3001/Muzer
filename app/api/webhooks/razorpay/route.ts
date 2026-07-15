import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prismaClient } from "@/app/lib/db";
import { publishQueueChanged } from "@/app/lib/redis";

// Razorpay webhook. Authenticity is proven by the HMAC signature over the raw
// body — there is NO user session here. This is the ONLY place Stream.bidAmountUnits
// ever changes, and only after a verified `payment.captured`. It must be
// idempotent: Razorpay retries until it gets a 2xx, so the same event can arrive
// many times and must credit the queue exactly once.
//
// We always return 200 (even for events we ignore or can't match) so Razorpay
// stops retrying — the only non-2xx is a bad/absent signature.

export async function POST(req: NextRequest) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    console.error("POST /api/webhooks/razorpay failed: RAZORPAY_WEBHOOK_SECRET not set");
    // Misconfiguration, not Razorpay's fault — 500 so it's visible in logs and
    // Razorpay retries once the secret is configured.
    return NextResponse.json({ message: "Webhook not configured" }, { status: 500 });
  }

  // Signature is computed over the exact raw bytes — never parse before verifying.
  const raw = await req.text();
  const signature = req.headers.get("x-razorpay-signature") ?? "";

  const expected = crypto
    .createHmac("sha256", secret)
    .update(raw)
    .digest("hex");

  // Constant-time compare; guard against length mismatch (timingSafeEqual throws
  // on differing lengths).
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (
    sigBuf.length !== expBuf.length ||
    !crypto.timingSafeEqual(sigBuf, expBuf)
  ) {
    return NextResponse.json({ message: "Invalid signature" }, { status: 400 });
  }

  let event: RazorpayEvent;
  try {
    event = JSON.parse(raw) as RazorpayEvent;
  } catch {
    // Signature matched but body isn't JSON — nothing to do, don't make Razorpay retry.
    console.error("POST /api/webhooks/razorpay failed: signature ok but body not JSON");
    return NextResponse.json({ received: true });
  }

  try {
    switch (event.event) {
      case "payment.captured":
        return await handlePaymentCaptured(event);
      case "payment.failed":
        return await handlePaymentFailed(event);
      case "account.updated":
        return await handleAccountUpdated(event);
      default:
        // Not an event we act on — acknowledge so retries stop.
        return NextResponse.json({ received: true });
    }
  } catch (e) {
    console.error("POST /api/webhooks/razorpay failed:", e);
    // 500 → Razorpay retries. Our handlers are idempotent, so a retry is safe.
    return NextResponse.json({ message: "Webhook processing error" }, { status: 500 });
  }
}

// A captured payment: flip the Payment to succeeded and credit the track's bid,
// atomically, exactly once. Then fire the realtime signal AFTER the tx commits.
async function handlePaymentCaptured(event: RazorpayEvent) {
  const orderId = event.payload?.payment?.entity?.order_id;
  if (!orderId) {
    return NextResponse.json({ received: true });
  }

  const payment = await prismaClient.payment.findUnique({
    where: { providerRef: orderId },
    include: { stream: { include: { session: true } } },
  });

  // Not one of ours (some other order) — ignore.
  if (!payment) {
    return NextResponse.json({ received: true });
  }

  // Already credited — idempotent no-op. This is the retry path.
  if (payment.status === "succeeded") {
    return NextResponse.json({ received: true });
  }

  // The paid track was already played out and deleted (streamId set null). Take
  // the money (mark succeeded) but there's no queue position left to bump.
  if (!payment.stream || !payment.streamId) {
    await prismaClient.payment.update({
      where: { id: payment.id },
      data: { status: "succeeded" },
    });
    return NextResponse.json({ received: true });
  }

  const sessionCode = payment.stream.session?.code;

  // Single transaction: flip pending → succeeded AND credit the track's bid,
  // exactly once. The status read above is outside the tx, so a *concurrent*
  // duplicate delivery could also see 'pending'. The conditional updateMany is
  // the real guard: only the racer whose flip actually transitions the row
  // (count === 1) credits the bid; a loser sees count === 0 and skips it. This
  // makes the increment idempotent under both sequential retries and concurrent
  // duplicates.
  const credited = await prismaClient.$transaction(async (tx) => {
    const flip = await tx.payment.updateMany({
      where: { id: payment.id, status: "pending" },
      data: { status: "succeeded" },
    });
    if (flip.count === 0) return false;
    await tx.stream.update({
      where: { id: payment.streamId! },
      data: { bidAmountUnits: { increment: payment.amountUnits } },
    });
    return true;
  });

  // Realtime nudge AFTER commit, and only if we were the one that credited —
  // reuse the existing coarse "changed" signal, no new event type. Clients
  // revalidate and the track jumps.
  if (credited && sessionCode) {
    await publishQueueChanged(sessionCode);
  }

  return NextResponse.json({ received: true });
}

// A failed payment: record it, never touch the queue.
async function handlePaymentFailed(event: RazorpayEvent) {
  const orderId = event.payload?.payment?.entity?.order_id;
  if (!orderId) {
    return NextResponse.json({ received: true });
  }

  const payment = await prismaClient.payment.findUnique({
    where: { providerRef: orderId },
  });
  // Only move pending → failed; never downgrade a succeeded row.
  if (payment && payment.status === "pending") {
    await prismaClient.payment.update({
      where: { id: payment.id },
      data: { status: "failed" },
    });
  }
  return NextResponse.json({ received: true });
}

// A Route linked account changed: keep the host's payout-enabled flag in sync so
// bids are only offered when payouts actually work.
async function handleAccountUpdated(event: RazorpayEvent) {
  const account = event.payload?.account?.entity;
  const accountId = account?.id;
  if (!accountId) {
    return NextResponse.json({ received: true });
  }

  const payoutsEnabled = derivePayoutsEnabled(account);

  // Match by the id we stored at onboarding. No-op if we don't know this account.
  await prismaClient.user.updateMany({
    where: { razorpayAccountId: accountId },
    data: { razorpayPayoutsEnabled: payoutsEnabled },
  });

  return NextResponse.json({ received: true });
}

// Razorpay's account payload shape varies by product; treat the account as
// payout-ready when it's activated / marked live. Conservative default: false.
function derivePayoutsEnabled(account: RazorpayAccountEntity): boolean {
  if (typeof account.payouts_enabled === "boolean") return account.payouts_enabled;
  if (account.status) return account.status === "activated";
  if (account.activation_details?.activation_status) {
    return account.activation_details.activation_status === "activated";
  }
  return false;
}

// ---- Minimal typings for the slices of the webhook payload we read ----

interface RazorpayAccountEntity {
  id?: string;
  status?: string;
  payouts_enabled?: boolean;
  activation_details?: { activation_status?: string };
}

interface RazorpayEvent {
  event: string;
  payload?: {
    payment?: { entity?: { order_id?: string } };
    account?: { entity?: RazorpayAccountEntity };
  };
}
