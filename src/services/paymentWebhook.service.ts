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
import { isPlanId, PLANS, DAY_MS } from "./plans.js";

export type WebhookOutcome =
  | "fulfilled"
  | "duplicate"
  | "refunded"
  | "refund_pending"
  | "unknown_order"
  | "mismatch"
  | "payment_failed"
  | "refunded_externally"
  | "partial_refund"
  | "ignored";

const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9_]{1,80}$`));

const envelope = z.object({
  event: z.string().max(64),
  payload: z.looseObject({
    payment: z.object({ entity: z.record(z.string(), z.unknown()) }).optional(),
    refund: z.object({ entity: z.record(z.string(), z.unknown()) }).optional(),
  }),
});

const processedRefund = z.object({ id: id("rfnd"), payment_id: id("pay"), amount: z.number().int().positive() });

const capturedPayment = z.object({
  id: id("pay"),
  order_id: id("order"),
  amount: z.number().int().positive(),
  currency: z.string(),
  status: z.string(),
});

/** Events that mean "the money is in". `order.paid` is Razorpay's recommended one; both carry the payment. */
const PAID_EVENTS = new Set(["order.paid", "payment.captured"]);

/**
 * Money returned from the Razorpay dashboard (we never start these). A full refund takes back
 * what the payment bought: the days it added come off the plan, and the payment is marked in the
 * billing history. A partial refund changes nothing and is raised for a person to decide.
 * Refunds we issue ourselves are never here: those orders are no longer FULFILLED.
 */
async function handleProcessedRefund(refundEntity: unknown, paymentEntity: Record<string, unknown> | undefined): Promise<WebhookOutcome> {
  const refund = processedRefund.safeParse(refundEntity);
  if (!refund.success) return "ignored";
  const { id: refundId, payment_id: paymentId, amount } = refund.data;

  const order = await prisma.paymentOrder.findUnique({ where: { razorpayPaymentId: paymentId } });
  if (!order || order.status !== "FULFILLED") return "ignored";

  const totalRefunded = Math.max(amount, typeof paymentEntity?.amount_refunded === "number" ? paymentEntity.amount_refunded : 0);
  if (totalRefunded < order.amount) {
    logger.warn("Partial refund made in the Razorpay dashboard; the plan was left alone", { orderId: order.id, paymentId, refunded: totalRefunded, paid: order.amount });
    void raiseAlert("refund_external", `Partial refund (${totalRefunded} of ${order.amount} paise) on payment ${paymentId}: decide by hand whether to shorten the plan`);
    return "partial_refund";
  }

  const applied = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "PaymentOrder" WHERE "id" = ${order.id} FOR UPDATE`;
    const locked = await tx.paymentOrder.findUniqueOrThrow({ where: { id: order.id } });
    if (locked.status !== "FULFILLED") return false;

    if (locked.shopkeeperId && isPlanId(locked.planType)) {
      const [owner] = await tx.$queryRaw<{ planExpiresAt: Date }[]>`SELECT "planExpiresAt" FROM "Shopkeeper" WHERE "id" = ${locked.shopkeeperId} FOR UPDATE`;
      if (owner) {
        const takenBack = owner.planExpiresAt.getTime() - PLANS[locked.planType].days * DAY_MS;
        await tx.shopkeeper.update({ where: { id: locked.shopkeeperId }, data: { planExpiresAt: new Date(Math.max(takenBack, Date.now())) } });
      }
    }
    await tx.planPayment.updateMany({ where: { razorpayPaymentId: paymentId }, data: { refundedAt: new Date() } });
    await tx.paymentOrder.update({
      where: { id: locked.id },
      data: { status: "REFUNDED", razorpayRefundId: refundId, failureReason: "refunded from the Razorpay dashboard" },
    });
    return true;
  });
  if (!applied) return "ignored";

  logger.warn("Payment refunded from the Razorpay dashboard; plan time taken back", { orderId: order.id, paymentId, purpose: order.purpose });
  void raiseAlert("refund_external", `Payment ${paymentId} was refunded in the Razorpay dashboard; ${PLANS[order.planType as keyof typeof PLANS]?.days ?? "?"} days were taken off the plan`);
  return "refunded_externally";
}

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
  if (event === "refund.processed") return handleProcessedRefund(payload.refund?.entity, entity);
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
