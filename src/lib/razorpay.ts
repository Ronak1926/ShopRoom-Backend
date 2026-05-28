/**
 * razorpay.ts — Razorpay SDK wrapper
 *
 * ─── KEY CONCEPTS ─────────────────────────────────────────────────────────────
 *
 * KEY_ID  (RAZORPAY_KEY_ID)
 *   • Public identifier — safe to expose in the frontend (window.Razorpay checkout)
 *   • Used only to open the checkout UI
 *
 * KEY_SECRET  (RAZORPAY_KEY_SECRET)
 *   • PRIVATE — never expose to the client
 *   • Used to: create orders, verify payment signatures, verify webhook signatures
 *
 * ─── WHY SIGNATURE VERIFICATION IS MANDATORY ─────────────────────────────────
 *
 * After payment, Razorpay sends payment details (orderId, paymentId, signature)
 * back to the browser. Without server-side verification, an attacker could:
 *  • Fake a payment_id and claim a payment succeeded
 *  • Replay a valid payment for a different order
 *
 * The signature is: HMAC_SHA256(orderId + "|" + paymentId, KEY_SECRET)
 * Only Razorpay (who generated the signature) and you (with KEY_SECRET) can
 * produce or verify this value. We use crypto.timingSafeEqual to prevent
 * timing-based attacks.
 *
 * ─── COMMON SECURITY MISTAKES ────────────────────────────────────────────────
 *  ❌ Trusting the payment_id from the frontend without verifying the signature
 *  ❌ Verifying on the frontend (KEY_SECRET would be exposed)
 *  ❌ Using === for signature comparison (vulnerable to timing attacks)
 *  ❌ Storing KEY_SECRET in source code or client-side env vars
 *  ❌ Not validating the amount on the backend (Razorpay order amount vs. your DB)
 *  ❌ Skipping webhook signature verification (allows spoofed webhook events)
 */

import Razorpay from "razorpay";
import crypto from "crypto";

// ─── Client factory ───────────────────────────────────────────────────────────

/**
 * Returns a Razorpay client instance or null when credentials are absent.
 * Null triggers dev-mode fallbacks in the service layer.
 */
function getClient(): Razorpay | null {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) return null;
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

// ─── Create Order ─────────────────────────────────────────────────────────────

export interface RazorpayOrderResult {
  orderId: string;
  amount: number; // paise
  currency: string;
  keyId: string; // public key — sent to frontend to open checkout
  mock?: boolean;
}

/**
 * Creates a Razorpay order on the backend.
 *
 * WHY ORDER FIRST?
 * ─────────────────
 * Razorpay requires a server-side order before the checkout opens.
 * This lets us:
 *  • Record the expected amount in a DB-backed order
 *  • Verify afterward that the paid amount matches the ordered amount
 *  • Tie the payment back to our draftId via the `receipt` field
 *
 * @param amount  Amount in paise (e.g. 39900 = ₹399)
 * @param receipt Short unique identifier for your records (not shown to user)
 */
export async function createRazorpayOrder(
  amount: number,
  receipt: string,
): Promise<RazorpayOrderResult> {
  const keyId = process.env.RAZORPAY_KEY_ID ?? "";
  const client = getClient();

  if (!client) {
    console.warn(
      `\n⚠️  [Razorpay] Credentials not configured — returning mock order.\n` +
        `   Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env\n` +
        `   DEV: amount ₹${amount / 100}, receipt: ${receipt}\n`,
    );
    return {
      orderId: `order_mock_${receipt}_${Date.now()}`,
      amount,
      currency: "INR",
      keyId: "rzp_test_mock",
      mock: true,
    };
  }

  const order = (await (client.orders.create({
    amount,
    currency: "INR",
    receipt,
    // 1 = auto-capture on payment success (no manual capture required)
    payment_capture: true,
  }) as unknown)) as { id: string; amount: number | string; currency: string };

  return {
    orderId: order.id,
    amount: Number(order.amount),
    currency: order.currency,
    keyId,
  };
}

// ─── Verify Payment Signature ─────────────────────────────────────────────────

/**
 * Verifies the Razorpay payment signature.
 *
 * Algorithm:
 *   body      = razorpayOrderId + "|" + razorpayPaymentId
 *   expected  = HMAC_SHA256(body, KEY_SECRET).hexdigest()
 *   valid     = timingSafeEqual(expected, razorpaySignature)
 *
 * @returns true if the signature is valid, false otherwise
 */
export function verifyPaymentSignature(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  razorpaySignature: string,
): boolean {
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keySecret) {
    // Dev fallback: skip verification when credentials are absent
    console.warn(
      "[Razorpay] KEY_SECRET not set — skipping signature verification in dev mode",
    );
    return true;
  }

  const body = `${razorpayOrderId}|${razorpayPaymentId}`;
  const expectedHex = crypto
    .createHmac("sha256", keySecret)
    .update(body)
    .digest("hex");

  // timingSafeEqual prevents timing-based attacks that could leak the secret
  try {
    const expected = Buffer.from(expectedHex, "hex");
    const received = Buffer.from(razorpaySignature, "hex");
    if (expected.length !== received.length) return false;
    return crypto.timingSafeEqual(expected, received);
  } catch {
    // Buffer.from throws if the signature isn't valid hex
    return false;
  }
}

// ─── Verify Webhook Signature ─────────────────────────────────────────────────

/**
 * Verifies a Razorpay webhook signature.
 *
 * Razorpay sends: X-Razorpay-Signature: HMAC_SHA256(rawBody, WEBHOOK_SECRET)
 *
 * IMPORTANT: The raw request body (before JSON.parse) must be used here.
 * If you pass the parsed/re-stringified body the signature will not match.
 *
 * Setup at: razorpay.com Dashboard → Settings → Webhooks → Add webhook URL
 */
export function verifyWebhookSignature(
  rawBody: string,
  razorpaySignature: string,
): boolean {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.warn(
      "[Razorpay] RAZORPAY_WEBHOOK_SECRET not set — skipping webhook signature verification",
    );
    return true;
  }

  const expected = crypto
    .createHmac("sha256", webhookSecret)
    .update(rawBody)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(razorpaySignature),
    );
  } catch {
    return false;
  }
}
