/**
 * services/paymentReceipt.service.ts — The email a shopkeeper gets after paying.
 *
 * A receipt is a courtesy, never part of the payment: it is sent after the purchase is
 * granted, a failure here is logged and never reaches the buyer, and nothing waits for it.
 * `receiptSentAt` makes it once-only: the sender claims the order before sending and gives the
 * claim back if the mail fails, so a daily sweep (and any other caller) can try again.
 */

import { prisma } from "../database/prisma.js";
import { isEmailConfigured, sendPaymentReceiptEmail } from "../lib/email.js";
import { logger } from "../lib/logger.js";
import { isPlanId, PLANS } from "./plans.js";

/** Receipts older than this are not worth sending late. */
const RECEIPT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** A sweep leaves recent orders alone: the sender that granted them is probably still on its way. */
const RECEIPT_SWEEP_GRACE_MS = 10 * 60 * 1000;
const RECEIPT_SWEEP_BATCH = 50;

/** Sends the receipt for a fulfilled order unless one has gone out already. Never throws. Returns whether an email was sent. */
export async function sendReceiptForOrder(orderId: string): Promise<boolean> {
  if (!isEmailConfigured()) {
    logger.warn("Payment receipt not sent: email is not configured", { orderId });
    return false;
  }
  try {
    const claimed = await prisma.paymentOrder.updateMany({
      where: { id: orderId, status: "FULFILLED", receiptSentAt: null, shopkeeperId: { not: null } },
      data: { receiptSentAt: new Date() },
    });
    if (claimed.count === 0) return false;

    try {
      const order = await prisma.paymentOrder.findUniqueOrThrow({
        where: { id: orderId },
        select: {
          id: true,
          purpose: true,
          planType: true,
          amount: true,
          razorpayPaymentId: true,
          fulfilledAt: true,
          shopkeeper: { select: { email: true, ownerName: true, shopName: true } },
        },
      });
      if (!order.shopkeeper || !order.razorpayPaymentId) throw new Error("order has no shopkeeper or payment id");
      await sendPaymentReceiptEmail(order.shopkeeper.email, {
        recipientName: order.shopkeeper.ownerName,
        shopName: order.shopkeeper.shopName,
        planLabel: isPlanId(order.planType) ? PLANS[order.planType].label : order.planType,
        purpose: order.purpose,
        amount: order.amount,
        paidAt: order.fulfilledAt ?? new Date(),
        paymentId: order.razorpayPaymentId,
        orderRef: order.id,
      });
      return true;
    } catch (err) {
      // Give the claim back so the sweep tries again.
      await prisma.paymentOrder.updateMany({ where: { id: orderId }, data: { receiptSentAt: null } });
      throw err;
    }
  } catch (err) {
    logger.error("Payment receipt failed; it will be retried", err, { orderId });
    return false;
  }
}

/** Fire-and-forget entry point used right after a purchase is granted. */
export function sendReceiptInBackground(orderId: string): void {
  void sendReceiptForOrder(orderId);
}

/** Retries receipts that did not go out. Run by the daily maintenance job; returns how many were sent. */
export async function retryUnsentReceipts(now = new Date()): Promise<number> {
  if (!isEmailConfigured()) return 0;
  const pending = await prisma.paymentOrder.findMany({
    where: {
      status: "FULFILLED",
      receiptSentAt: null,
      shopkeeperId: { not: null },
      fulfilledAt: { gt: new Date(now.getTime() - RECEIPT_MAX_AGE_MS), lt: new Date(now.getTime() - RECEIPT_SWEEP_GRACE_MS) },
    },
    select: { id: true },
    orderBy: { fulfilledAt: "asc" },
    take: RECEIPT_SWEEP_BATCH,
  });
  const sent = await Promise.all(pending.map((order) => sendReceiptForOrder(order.id)));
  return sent.filter(Boolean).length;
}
