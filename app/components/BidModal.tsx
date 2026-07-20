"use client";

import { useEffect, useState } from "react";
import { Banknote, X, Loader2 } from "lucide-react";

// Razorpay Checkout is loaded globally via <Script> in app/layout.tsx. Minimal
// typing for the slice we use.
interface RazorpayCheckout {
  open: () => void;
}
interface RazorpayCheckoutOptions {
  key?: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description?: string;
  handler: () => void;
  theme?: { color?: string };
  modal?: { ondismiss?: () => void };
}
declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => RazorpayCheckout;
  }
}

type BidModalProps = {
  // The track to boost. No session code needed — POST /api/streams/bid derives
  // the session (and its host's payout account) from the stream server-side.
  streamId: string;
  hostAcceptsPayments: boolean;
  onClose: () => void;
  // Fired once the guest completes Razorpay Checkout. The queue does NOT move
  // here — it moves when the webhook credits the bid and SSE revalidates.
  onSuccess: () => void;
};

// Rupee quick-picks (value in paise). Must sit within BID_MIN/MAX_PAISE.
const QUICK_PICKS = [
  { label: "₹10", paise: 1000 },
  { label: "₹50", paise: 5000 },
  { label: "₹100", paise: 10000 },
];

export function BidModal({
  streamId,
  hostAcceptsPayments,
  onClose,
  onSuccess,
}: BidModalProps) {
  // Amount is held in whole rupees in the input; converted to paise on submit.
  const [rupees, setRupees] = useState("50");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Close on Escape for keyboard users.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const placeBid = async () => {
    setError(null);
    const rupeeVal = Number(rupees);
    if (!Number.isFinite(rupeeVal) || rupeeVal <= 0) {
      setError("Enter an amount in ₹.");
      return;
    }
    const amountPaise = Math.round(rupeeVal * 100);

    if (!window.Razorpay) {
      setError("Payment system is still loading — try again in a moment.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/streams/bid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ streamId, amountPaise }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.message ?? "Could not start the bid.");
        setSubmitting(false);
        return;
      }

      const rzp = new window.Razorpay({
        key: json.keyId,
        order_id: json.orderId,
        amount: json.amountPaise,
        currency: json.currency,
        name: "Muzer",
        description: "Boost this track in the queue",
        theme: { color: "#10b981" },
        handler: () => {
          // Payment submitted. Do NOT optimistically reorder — the webhook
          // credits the bid and SSE will revalidate. Just confirm and close.
          onSuccess();
        },
        modal: {
          // Guest closed Checkout without paying — re-enable the form.
          ondismiss: () => setSubmitting(false),
        },
      });
      rzp.open();
    } catch (e) {
      console.error("placeBid failed:", e);
      setError("Something went wrong starting the bid.");
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-emerald-400/20 bg-[#0b0710] p-6 shadow-[0_0_60px_-15px_rgba(16,185,129,0.5)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Banknote className="h-5 w-5 text-emerald-300" />
            <h2 className="text-lg font-bold text-white">Boost this track</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 transition-colors hover:text-white"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {!hostAcceptsPayments ? (
          <p className="text-sm text-slate-300">
            This host hasn&apos;t set up payments yet, so bidding isn&apos;t
            available in this room. You can still vote to move tracks up.
          </p>
        ) : (
          <>
            <p className="mb-4 text-sm text-slate-300/80">
              Pay to jump this track up the queue. A bigger bid outranks every
              track with a smaller (or no) bid.
            </p>

            <div className="mb-3 flex gap-2">
              {QUICK_PICKS.map((q) => (
                <button
                  key={q.paise}
                  onClick={() => setRupees(String(q.paise / 100))}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition-all ${
                    Math.round(Number(rupees) * 100) === q.paise
                      ? "border-emerald-400 bg-emerald-400/15 text-emerald-200"
                      : "border-white/10 bg-white/[0.04] text-slate-200 hover:border-emerald-400/40"
                  }`}
                >
                  {q.label}
                </button>
              ))}
            </div>

            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">
              Amount (₹)
            </label>
            <div className="relative mb-4">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                ₹
              </span>
              <input
                type="number"
                min={1}
                value={rupees}
                onChange={(e) => setRupees(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-black/40 py-3 pl-8 pr-3 text-white placeholder-slate-500 focus:border-emerald-400/60 focus:outline-none focus:ring-1 focus:ring-emerald-400/40"
                onKeyDown={(e) => e.key === "Enter" && !submitting && placeBid()}
              />
            </div>

            {error && <p className="mb-3 text-sm text-rose-300">{error}</p>}

            <button
              onClick={placeBid}
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-900/30 transition-all hover:from-emerald-400 hover:to-cyan-500 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Bidding…
                </>
              ) : (
                "Place bid"
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
