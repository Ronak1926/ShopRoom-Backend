/**
 * services/paymentWebhook.service.ts — Razorpay's server-to-server notifications.
 *
 * This is what makes a purchase survive a closed tab: the browser may never get to call us
 * after paying, but Razorpay keeps retrying this webhook for up to a day. The signature has
 * already been checked by the time an event gets here (see the controller), but the payment
 * inside it is still compared with OUR record of the order before anything is granted.
 *
 * Replies matter: Razorpay retries any non-2xx. An event we can never act on (unknown order,
 * wrong amount) is answered "done"; one we merely failed to finish (database down, refund
 * not yet accepted) is reported as retryable so Razorpay sends it again.
 */

import z from "zod";
import { prisma } from "../database/prisma.js";
import { logger } from "../lib/logger.js";
import { raiseAlert } from "./alerting.service.js";
import { settlePayment } from "./paymentSettlement.service.js";

export type WebhookOutcome =
  | "fulfilled"
  | "duplicate"
  | "refunded"
  | "refund_pending"
  | "unknown_order"
  | "mismatch"
  | "payment_failed"
  | "ignored";

const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9_]{1,80}$`));

const envelope = z.object({
  event: z.string().max(64),
  payload: z.looseObject({ payment: z.object({ entity: z.record(z.string(), z.unknown()) }).optional() }),
});

const capturedPayment = z.object({
  id: id("pay"),
  order_id: id("order"),
  amount: z.number().int().positive(),
  currency: z.string(),
  status: z.string(),
});

/** Events that mean "the money is in". `order.paid` is Razorpay's recommended one; both carry the payment. */
const PAID_EVENTS = new Set(["order.paid", "payment.captured"]);

export async function handleRazorpayEvent(body: unknown): Promise<WebhookOutcome> {
  const parsed = envelope.safeParse(body);
  if (!parsed.success) return "ignored";
  const { event, payload } = parsed.data;
  const entity = payload.payment?.entity;

  if (event === "payment.failed") {
    // The buyer can retry inside Checkout, on the same order; nothing to undo.
    logger.warn("Razorpay payment failed", { orderId: entity?.order_id, code: entity?.error_code, reason: entity?.error_description });
    return "payment_failed";
  }
  if (!PAID_EVENTS.has(event) || !entity) return "ignored";

  const payment = capturedPayment.safeParse(entity);
  if (!payment.success) {
    logger.warn("Razorpay paid event had an unexpected payment shape", { event });
    return "ignored";
  }
  const { id: paymentId, order_id: razorpayOrderId, amount, currency, status } = payment.data;

  const order = await prisma.paymentOrder.findUnique({ where: { razorpayOrderId } });
  if (!order) {
    // The Razorpay account may also take payments for things that are not ours.
    logger.warn("Paid event for an order this app did not create", { paymentId, razorpayOrderId });
    return "unknown_order";
  }

  // The payment must be exactly what we asked for. A mismatch is never granted and never retried:
  // retrying would give the same answer, so it is raised for a person to look at.
  if (status !== "captured" || currency !== "INR" || amount !== order.amount) {
    logger.error("Paid event does not match the order", undefined, { orderId: order.id, paymentId, status, currency, amount, expected: order.amount });
    void raiseAlert("payment_failures", `Payment ${paymentId} does not match order ${order.id} (amount ${amount}, expected ${order.amount})`);
    return "mismatch";
  }

  const settlement = await settlePayment(order, paymentId);
  switch (settlement.status) {
    case "FULFILLED":
      return settlement.firstTime ? "fulfilled" : "duplicate";
    case "REFUNDED":
      return "refunded";
    case "NEEDS_REFUND":
      return "refund_pending";
  }
}
