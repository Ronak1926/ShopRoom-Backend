/**
 * lib/razorpay.ts — The only place that talks to Razorpay (and the only place that
 * reads its keys).
 *
 *   RAZORPAY_KEY_ID          public; sent to the browser to open Checkout
 *   RAZORPAY_KEY_SECRET      private; creates orders and refunds, signs payment confirmations
 *   RAZORPAY_WEBHOOK_SECRET  private; signs webhook deliveries (a separate secret, set in the dashboard)
 *
 * What is checked, and why:
 *  - A payment confirmation from the browser carries HMAC_SHA256(orderId|paymentId, KEY_SECRET).
 *    Only Razorpay can produce it, so it proves that payment really belongs to that order.
 *  - A webhook carries HMAC_SHA256(rawBody, WEBHOOK_SECRET); the RAW bytes are required.
 *  - Both comparisons are constant time, and both fail CLOSED in production when a secret is missing.
 *  - Without credentials in development a mock order is issued so the flow can be tried end to end;
 *    in production that same situation is an error, never a free purchase.
 *
 * Provider failures are logged with Razorpay's own code and description (never the keys) and
 * surface to callers as a PaymentProviderError whose message is safe to show.
 */

import Razorpay from "razorpay";
import crypto from "node:crypto";
import { isProduction } from "../config/env.js";
import { logger } from "./logger.js";

// ─── Client ───────────────────────────────────────────────────────────────────

/** The few SDK calls we use, typed by us so a test can stand in for the network. */
export interface RazorpayApi {
  orders: {
    create(body: { amount: number; currency: string; receipt: string; payment_capture: 0 | 1; notes?: Record<string, string> }): Promise<{
      id: string;
      amount: number | string;
      currency: string;
    }>;
  };
  payments: {
    refund(
      paymentId: string,
      body: { amount: number; speed: "normal" | "optimum"; notes?: Record<string, string>; receipt?: string },
    ): Promise<{ id: string }>;
  };
}

let clientOverride: RazorpayApi | null = null;

/** Test seam: replaces the network client. Pass null to restore the real one. */
export function setRazorpayClientForTests(client: RazorpayApi | null): void {
  clientOverride = client;
}

/** The real client, or null when credentials are absent (development then uses mock orders). */
function getClient(): RazorpayApi | null {
  if (clientOverride) return clientOverride;
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) return null;
  return new Razorpay({ key_id: keyId, key_secret: keySecret }) as unknown as RazorpayApi;
}

/** Used when the failure should reach the caller as "the payment service had a problem". */
export class PaymentProviderError extends Error {
  constructor(
    message: string,
    /** True for timeouts and 5xx: trying again later can work. */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "PaymentProviderError";
  }
}

const UNAVAILABLE = "The payment service is unavailable right now. Please try again in a moment.";
const ORDER_TIMEOUT_MS = 10_000;
const REFUND_TIMEOUT_MS = 15_000;

interface SdkError {
  statusCode?: number;
  error?: { code?: string; description?: string };
}

function describe(err: unknown): { status?: number; code?: string; description: string } {
  const e = err as SdkError & { message?: string };
  return { status: e?.statusCode, code: e?.error?.code, description: e?.error?.description ?? e?.message ?? "unknown error" };
}

/** The SDK has no timeout of its own: without one a stalled connection would hold the request open. */
function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

// ─── Create order ─────────────────────────────────────────────────────────────

export interface RazorpayOrderResult {
  orderId: string;
  /** Paise. */
  amount: number;
  currency: string;
  /** The public key, for opening Checkout. */
  keyId: string;
  /** Development only: no real order exists and nothing is charged. */
  mock?: boolean;
}

export const MOCK_ORDER_PREFIX = "order_mock_";

export const isMockOrderId = (orderId: string): boolean => orderId.startsWith(MOCK_ORDER_PREFIX);

export const publicKeyId = (): string => process.env.RAZORPAY_KEY_ID || "rzp_test_mock";

/**
 * Creates the order Checkout pays against. Amount is in paise. `receipt` (at most 40 characters)
 * is our own order id, so a Razorpay dashboard row can be matched to ours.
 */
export async function createRazorpayOrder(input: {
  amount: number;
  receipt: string;
  notes?: Record<string, string>;
}): Promise<RazorpayOrderResult> {
  const client = getClient();

  if (!client) {
    // Without credentials a "mock" order would let anyone buy for free.
    if (isProduction()) throw new PaymentProviderError("Payments are not configured.", false);
    logger.warn("Razorpay credentials not configured: issuing a mock order (development only)", { receipt: input.receipt });
    return { orderId: `${MOCK_ORDER_PREFIX}${input.receipt}`, amount: input.amount, currency: "INR", keyId: publicKeyId(), mock: true };
  }

  try {
    const order = await withTimeout(
      client.orders.create({ amount: input.amount, currency: "INR", receipt: input.receipt, payment_capture: 1, notes: input.notes }),
      ORDER_TIMEOUT_MS,
      "Razorpay order creation",
    );
    return { orderId: order.id, amount: Number(order.amount), currency: order.currency, keyId: publicKeyId() };
  } catch (err) {
    const { status, code, description } = describe(err);
    logger.error("Razorpay order creation failed", undefined, { status, code, description, receipt: input.receipt });
    throw new PaymentProviderError(UNAVAILABLE, status === undefined || status >= 500);
  }
}

// ─── Refund ───────────────────────────────────────────────────────────────────

/** Razorpay's wording when asked to refund money that has already gone back. */
const ALREADY_REFUNDED = /fully refunded|already (been )?refunded|refund amount .* greater than/i;

/**
 * Returns the full amount of a payment. Safe to call again: if Razorpay says the payment is
 * already refunded the call counts as done (`id: null`), because the goal, money returned, is met.
 */
export async function refundPayment(
  paymentId: string,
  amount: number,
  notes: Record<string, string> = {},
): Promise<{ id: string | null }> {
  const client = getClient();

  if (!client) {
    if (isProduction()) throw new PaymentProviderError("Payments are not configured.", false);
    return { id: `rfnd_mock_${paymentId}` };
  }

  try {
    const refund = await withTimeout(client.payments.refund(paymentId, { amount, speed: "normal", notes }), REFUND_TIMEOUT_MS, "Razorpay refund");
    return { id: refund.id };
  } catch (err) {
    const { status, code, description } = describe(err);
    if (ALREADY_REFUNDED.test(description)) return { id: null };
    logger.error("Razorpay refund failed", undefined, { status, code, description, paymentId });
    throw new PaymentProviderError("The refund could not be started.", status === undefined || status >= 500);
  }
}

// ─── Signatures ───────────────────────────────────────────────────────────────

/** Constant-time comparison of two hex digests; false for any malformed input. */
function sameDigest(expectedHex: string, receivedHex: string): boolean {
  if (!/^[0-9a-f]+$/i.test(receivedHex) || receivedHex.length !== expectedHex.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expectedHex, "hex"), Buffer.from(receivedHex, "hex"));
}

/**
 * Checks the signature Checkout hands the browser after a payment:
 * HMAC_SHA256(`${orderId}|${paymentId}`, KEY_SECRET).
 */
export function verifyPaymentSignature(razorpayOrderId: string, razorpayPaymentId: string, razorpaySignature: string): boolean {
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keySecret) {
    // Skipping verification in production would make every payment "valid".
    if (isProduction()) return false;
    logger.warn("RAZORPAY_KEY_SECRET not set: skipping signature verification (development only)");
    return true;
  }

  const expected = crypto.createHmac("sha256", keySecret).update(`${razorpayOrderId}|${razorpayPaymentId}`).digest("hex");
  return sameDigest(expected, razorpaySignature);
}

/**
 * Checks a webhook delivery: HMAC_SHA256(rawBody, WEBHOOK_SECRET) in X-Razorpay-Signature.
 * `rawBody` must be the bytes as received; a parsed and re-serialised body never matches.
 */
export function verifyWebhookSignature(rawBody: string, razorpaySignature: string): boolean {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!webhookSecret) {
    // Fail closed everywhere: an unsigned webhook is indistinguishable from a forged one.
    logger.warn("RAZORPAY_WEBHOOK_SECRET not set: rejecting webhook");
    return false;
  }

  const expected = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  return sameDigest(expected, razorpaySignature);
}
