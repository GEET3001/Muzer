import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/lib/auth";
import { prismaClient } from "@/app/lib/db";
import { isParticipant } from "@/app/lib/access";
import { rateLimit } from "@/app/lib/redis";
import { getRazorpay } from "@/app/lib/razorpay";

// Server-authoritative bid bounds (paise). The client's amount is validated
// against these; the charge is never taken from a raw client value.
const BID_MIN_PAISE = Number(process.env.BID_MIN_PAISE ?? 100);
const BID_MAX_PAISE = Number(process.env.BID_MAX_PAISE ?? 1000000);
const PLATFORM_FEE_PERCENT = Number(process.env.PLATFORM_FEE_PERCENT ?? 5);

const BidSchema = z.object({
  streamId: z.string().min(1),
  amountPaise: z.number().int().min(BID_MIN_PAISE).max(BID_MAX_PAISE),
});

// Guest-facing: start a bid to boost a track. This ONLY creates a Razorpay order
// and a pending Payment row — it never touches Stream.bidAmountUnits or the
// queue. The money only moves the queue after Razorpay captures the payment and
// the webhook credits it (see app/api/webhooks/razorpay/route.ts).
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const user = await prismaClient.user.findUnique({
      where: { email: session.user.email },
    });
    if (!user) {
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

    // Throttle bid spam: 10 / minute per user.
    if (!(await rateLimit(`bid:${user.id}`, 10, 60))) {
      return NextResponse.json(
        { message: "Slow down — too many bids" },
        { status: 429 }
      );
    }

    const parsed = BidSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { message: "Invalid request body" },
        { status: 400 }
      );
    }
    const { streamId, amountPaise } = parsed.data;

    // Load the track with its session and the session host (we need the host's
    // Razorpay linked account to route the payout).
    const stream = await prismaClient.stream.findUnique({
      where: { id: streamId },
      include: { session: { include: { host: true } } },
    });
    if (!stream || !stream.session) {
      return NextResponse.json({ message: "Track not found" }, { status: 404 });
    }
    const foundSession = stream.session;
    const host = foundSession.host;

    // Only participants (host or joined members) can bid.
    if (!(await isParticipant(user.id, foundSession))) {
      return NextResponse.json(
        { message: "Join this stream to bid" },
        { status: 403 }
      );
    }

    // Can't bid on the track that's already playing — bids reorder the upcoming
    // queue only, same guarantee votes have.
    if (stream.id === foundSession.currentStreamId) {
      return NextResponse.json(
        { message: "Can't bid on the track that's already playing" },
        { status: 409 }
      );
    }

    // Host must have a live payout account or there's nowhere to route the money.
    if (!host.razorpayAccountId || !host.razorpayPayoutsEnabled) {
      return NextResponse.json(
        { message: "Host hasn't set up payments" },
        { status: 409 }
      );
    }

    // Split server-side. Platform keeps the fee; the rest is transferred to the
    // host's linked account. Never derived from anything the client sent.
    const platformFeePaise = Math.floor(
      (amountPaise * PLATFORM_FEE_PERCENT) / 100
    );
    const hostSharePaise = amountPaise - platformFeePaise;

    const idempotencyKey = crypto.randomUUID();

    // Build params in a variable so TS structural typing accepts the `transfers`
    // field (the SDK's create() overloads reject it on a fresh object literal).
    const orderParams = {
      amount: amountPaise,
      currency: "INR",
      receipt: idempotencyKey,
      notes: {
        streamId,
        sessionCode: foundSession.code,
        payerId: user.id,
      },
      transfers: [
        {
          account: host.razorpayAccountId,
          amount: hostSharePaise,
          currency: "INR",
          notes: { streamId, kind: "host_share" },
          on_hold: 0 as const,
        },
      ],
    };

    const order = await getRazorpay().orders.create(orderParams);

    await prismaClient.payment.create({
      data: {
        streamId,
        payerId: user.id,
        amountUnits: amountPaise,
        platformFeeUnits: platformFeePaise,
        providerRef: order.id,
        idempotencyKey,
        status: "pending",
      },
    });

    // The client opens Razorpay Checkout with these. bidAmountUnits stays put
    // until the webhook confirms capture.
    return NextResponse.json({
      orderId: order.id,
      keyId: process.env.RAZORPAY_KEY_ID,
      amountPaise,
      currency: "INR",
    });
  } catch (e) {
    console.error("POST /api/streams/bid failed:", e);
    return NextResponse.json(
      { message: "Could not start the bid" },
      { status: 500 }
    );
  }
}
