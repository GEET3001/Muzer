import Razorpay from "razorpay";

/**
 * Lazily-built Razorpay client. Only the payment routes call `getRazorpay()`,
 * and only while handling a request — never at module load. That matters because
 * Next collects page data for every route at build time: a module-level client
 * (or a module-level env check) would throw during `next build` in any
 * environment without keys (CI, a fresh clone). Here a missing key fails just
 * the payment request, loudly, rather than the whole build or unrelated routes.
 */
let client: Razorpay | null = null;

export function getRazorpay(): Razorpay {
  if (client) return client;

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new Error(
      "Razorpay is not configured: set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in your .env"
    );
  }

  client = new Razorpay({ key_id: keyId, key_secret: keySecret });
  return client;
}
