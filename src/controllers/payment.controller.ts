/**
 * controllers/payment.controller.ts — Paying for a shop's first plan, and Razorpay's
 * notifications about payments. (Renewals live in billing.controller.ts.)
 *
 *   POST /api/shopkeeper/payment/create-order   start a payment for a draft
 *   POST /api/shopkeeper/payment/verify         the browser reports a finished payment
 *   POST /api/shopkeeper/payment/webhook        Razorpay reports it (signed, raw body)
 *
 * What a payment buys is decided in the payment services, from our own order record.
 */

import type { Request, Response } from "express";
import z from "zod";
import { logger } from "../lib/logger.js";
import { razorpayWebhooks } from "../lib/metrics.js";
import { verifyWebhookSignature } from "../lib/razorpay.js";
import { recordWebhookFailure } from "../services/alerting.service.js";
import { createRegistrationOrder } from "../services/paymentOrder.service.js";
import { confirmClientPayment } from "../services/paymentSettlement.service.js";
import { handleRazorpayEvent, type WebhookOutcome } from "../services/paymentWebhook.service.js";
import { registrationResult } from "../services/registration.service.js";
import { signShopkeeperToken } from "../utils/jwt.js";
import { sendSession } from "../lib/sessionCookie.js";
import { PaymentError } from "../utils/paymentError.js";

const razorpayId = z.string().regex(/^[A-Za-z0-9_]{1,64}$/);
const draftId = z.string().min(1).max(64);

const createOrderSchema = z.object({ draftId, planType: z.enum(["1m", "2m", "3m"]) });

const verifySchema = z.object({
  draftId,
  razorpayOrderId: razorpayId,
  razorpayPaymentId: razorpayId,
  razorpaySignature: z.string().min(1).max(128),
});

/** Known, user-safe failures keep their message and status; anything else is logged and answered generically. */
export function respondWithPaymentFailure(res: Response, err: unknown, context: string, fallback: string): void {
  if (err instanceof PaymentError) {
    res.status(err.status).json({ message: err.message });
    return;
  }
  logger.error(context, err);
  res.status(500).json({ message: fallback });
}

// POST /api/shopkeeper/payment/create-order
export async function createPaymentOrder(req: Request, res: Response): Promise<void> {
  const parsed = createOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid request" });
    return;
  }
  try {
    res.json(await createRegistrationOrder(parsed.data.draftId, parsed.data.planType));
  } catch (err) {
    respondWithPaymentFailure(res, err, "Create order", "Could not start the payment. Please try again.");
  }
}

// POST /api/shopkeeper/payment/verify
export async function verifyPayment(req: Request, res: Response): Promise<void> {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid request" });
    return;
  }
  try {
    const { shopkeeperId } = await confirmClientPayment({
      razorpayOrderId: parsed.data.razorpayOrderId,
      razorpayPaymentId: parsed.data.razorpayPaymentId,
      razorpaySignature: parsed.data.razorpaySignature,
      owner: { draftId: parsed.data.draftId },
    });
    const account = await registrationResult(shopkeeperId);
    sendSession(req, res, "shopkeeper", signShopkeeperToken(account.shopkeeperId, account.tokenVersion), {
      message: "Payment verified. Registration complete.",
      shopkeeperId: account.shopkeeperId,
      shopId: account.shopId,
      roomId: account.roomId,
      inviteCode: account.inviteCode,
      inviteLink: account.inviteLink,
    });
  } catch (err) {
    respondWithPaymentFailure(res, err, "Payment verify", "We could not confirm your payment. Please try again; if money was taken, do not pay again.");
  }
}

/** Outcomes that mean "we did not finish": Razorpay should deliver the event again. */
const RETRY_OUTCOMES = new Set<WebhookOutcome>(["refund_pending"]);

// POST /api/shopkeeper/payment/webhook
export async function handleWebhook(req: Request, res: Response): Promise<void> {
  const signature = req.headers["x-razorpay-signature"];
  const rawBody = (req as Request & { rawBody?: string }).rawBody;

  if (typeof signature !== "string" || !rawBody) {
    res.status(400).json({ message: "Missing signature or body" });
    return;
  }
  if (!verifyWebhookSignature(rawBody, signature)) {
    logger.warn("Razorpay webhook rejected: invalid signature");
    razorpayWebhooks.inc({ result: "invalid_signature" });
    recordWebhookFailure();
    res.status(401).json({ message: "Invalid webhook signature" });
    return;
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    razorpayWebhooks.inc({ result: "invalid_body" });
    res.status(400).json({ message: "Invalid JSON body" });
    return;
  }

  try {
    const outcome = await handleRazorpayEvent(body);
    razorpayWebhooks.inc({ result: outcome });
    if (RETRY_OUTCOMES.has(outcome)) {
      res.status(503).json({ message: "Not finished; please retry" });
      return;
    }
    res.json({ received: true });
  } catch (err) {
    // The database or Razorpay failed us mid-way: a non-2xx makes Razorpay deliver this event again.
    razorpayWebhooks.inc({ result: "error" });
    logger.error("Razorpay webhook processing failed", err);
    res.status(500).json({ message: "Temporary failure; please retry" });
  }
}
