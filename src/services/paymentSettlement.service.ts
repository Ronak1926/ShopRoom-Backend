/**
 * services/paymentSettlement.service.ts — What a payment buys, exactly once.
 *
 * Two things tell us a payment happened: the browser (right after Checkout) and Razorpay's
 * webhook (which still arrives if the tab was closed or the network dropped). Both end up in
 * settlePayment(), which locks the order row, so whichever arrives first grants the purchase
 * and the other finds it done and gets the same answer. Granting and recording happen in one
 * transaction: a payment is never half-applied.
 *
 * When a payment cannot be honoured (the email was registered while the person was paying,
 * the sign-up session is gone, the account was deleted) the order is marked NEEDS_REFUND in
 * that same transaction, and the money is returned. If Razorpay is unreachable at that moment
 * the order stays NEEDS_REFUND and the refund is retried (webhook redelivery, then a sweep).
 */

import { Prisma } from "../generated/client.js";
import type { PaymentOrder } from "../generated/client.js";
import { prisma } from "../database/prisma.js";
import { logger } from "../lib/logger.js";
import { paymentRefunds, paymentVerifications } from "../lib/metrics.js";
import { refundPayment, verifyPaymentSignature } from "../lib/razorpay.js";
import { PaymentError } from "../utils/paymentError.js";
import { raiseAlert, recordPaymentFailure } from "./alerting.service.js";
import { sendReceiptInBackground } from "./paymentReceipt.service.js";
import { isPlanId, planEndsAt } from "./plans.js";
import { createAccountFromDraft } from "./registration.service.js";

export type Settlement =
  | { status: "FULFILLED"; shopkeeperId: string; fulfilledAt: Date; /** False when this call found it already granted. */ firstTime: boolean }
  | { status: "REFUNDED"; reason: string; paymentId: string }
  | { status: "NEEDS_REFUND"; reason: string; paymentId: string };

type Grant = { ok: true; shopkeeperId: string } | { ok: false; reason: string };

/** The reasons below are shown to the buyer: "We couldn't complete your registration (…)". */
async function grantRegistration(tx: Prisma.TransactionClient, order: PaymentOrder, paymentId: string): Promise<Grant> {
  if (!order.draftId) return { ok: false, reason: "the order was not linked to a sign-up" };
  // Serialises two orders paid for the same draft.
  await tx.$queryRaw`SELECT "id" FROM "ShopkeeperDraft" WHERE "id" = ${order.draftId} FOR UPDATE`;
  const draft = await tx.shopkeeperDraft.findUnique({ where: { id: order.draftId } });
  if (!draft) return { ok: false, reason: "your sign-up session was no longer available" };
  if (!draft.phoneVerified) return { ok: false, reason: "your phone number was not verified" };
  if (await tx.shopkeeper.findUnique({ where: { email: draft.email }, select: { id: true } })) {
    return { ok: false, reason: "an account with this email already exists" };
  }
  return { ok: true, ...(await createAccountFromDraft(tx, draft, order, paymentId)) };
}

async function grantRenewal(tx: Prisma.TransactionClient, order: PaymentOrder): Promise<Grant> {
  if (!order.shopkeeperId || !isPlanId(order.planType)) return { ok: false, reason: "the order was not linked to an account" };
  // Locking the row makes two renewals landing together extend the plan one after the other.
  const [owner] = await tx.$queryRaw<{ planExpiresAt: Date }[]>`SELECT "planExpiresAt" FROM "Shopkeeper" WHERE "id" = ${order.shopkeeperId} FOR UPDATE`;
  if (!owner) return { ok: false, reason: "your account no longer exists" };
  await tx.shopkeeper.update({
    where: { id: order.shopkeeperId },
    data: { planType: order.planType, planExpiresAt: planEndsAt(order.planType, owner.planExpiresAt) },
  });
  return { ok: true, shopkeeperId: order.shopkeeperId };
}

type GrantResult = { kind: "granted" | "already-settled" | "refund-needed"; order: PaymentOrder };

/** Locks the order and, if it is still unpaid, grants it (or marks it for refund) atomically. */
async function grantOrder(orderId: string, paymentId: string): Promise<GrantResult> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "PaymentOrder" WHERE "id" = ${orderId} FOR UPDATE`;
      const order = await tx.paymentOrder.findUniqueOrThrow({ where: { id: orderId } });
      if (order.status !== "CREATED") return { kind: "already-settled", order };

      const grant = order.purpose === "REGISTRATION" ? await grantRegistration(tx, order, paymentId) : await grantRenewal(tx, order);
      if (!grant.ok) {
        const flagged = await tx.paymentOrder.update({
          where: { id: orderId },
          data: { status: "NEEDS_REFUND", razorpayPaymentId: paymentId, failureReason: grant.reason },
        });
        return { kind: "refund-needed", order: flagged };
      }

      await tx.planPayment.create({
        data: {
          shopkeeperId: grant.shopkeeperId,
          purpose: order.purpose,
          planType: order.planType,
          amount: order.amount,
          razorpayOrderId: order.razorpayOrderId,
          razorpayPaymentId: paymentId,
        },
      });
      const fulfilled = await tx.paymentOrder.update({
        where: { id: orderId },
        data: { status: "FULFILLED", razorpayPaymentId: paymentId, shopkeeperId: grant.shopkeeperId, fulfilledAt: new Date() },
      });
      return { kind: "granted", order: fulfilled };
    },
    { timeout: 15_000 },
  );
}

/** A unique-key clash while granting means someone beat us to the same email. Anything else is a bug: let it surface. */
async function grantOrRecoverFromEmailClash(order: PaymentOrder, paymentId: string): Promise<GrantResult> {
  try {
    return await grantOrder(order.id, paymentId);
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002" || !order.draftId) throw err;
    const draft = await prisma.shopkeeperDraft.findUnique({ where: { id: order.draftId }, select: { email: true } });
    const taken = draft && (await prisma.shopkeeper.findUnique({ where: { email: draft.email }, select: { id: true } }));
    if (!taken) throw err;
    const flagged = await prisma.paymentOrder.update({
      where: { id: order.id },
      data: { status: "NEEDS_REFUND", razorpayPaymentId: paymentId, failureReason: "an account with this email already exists" },
    });
    return { kind: "refund-needed", order: flagged };
  }
}

/** Returns the money for an order we could not honour. Never throws: a failure leaves it NEEDS_REFUND for a retry. */
async function refundOrder(order: PaymentOrder): Promise<Settlement> {
  const paymentId = order.razorpayPaymentId;
  const reason = order.failureReason ?? "the purchase could not be completed";
  if (!paymentId) return { status: "NEEDS_REFUND", reason, paymentId: "" };

  try {
    const refund = await refundPayment(paymentId, order.amount, { order: order.id, reason: reason.slice(0, 200) });
    await prisma.paymentOrder.update({ where: { id: order.id }, data: { status: "REFUNDED", razorpayRefundId: refund.id } });
    paymentRefunds.inc({ result: "refunded" });
    logger.warn("Payment could not be honoured and was refunded", { orderId: order.id, purpose: order.purpose, reason });
    return { status: "REFUNDED", reason, paymentId };
  } catch (err) {
    paymentRefunds.inc({ result: "failed" });
    logger.error("Refund failed; it will be retried", err, { orderId: order.id, paymentId });
    void raiseAlert("refund_failed", `Refund of payment ${paymentId} (order ${order.id}) did not go through and is being retried`);
    return { status: "NEEDS_REFUND", reason, paymentId };
  }
}

/** A second, different payment against an order that is already settled has nothing to buy: send it back. */
async function refundSurplusPayment(order: PaymentOrder, paymentId: string): Promise<void> {
  logger.warn("A second payment arrived for a settled order; refunding it", { orderId: order.id, paymentId });
  await refundPayment(paymentId, order.amount, { order: order.id, reason: "duplicate payment" });
  paymentRefunds.inc({ result: "refunded" });
}

/**
 * Applies a verified payment to its order. Safe to call any number of times, from the browser
 * path and the webhook at once: the answer is the same and the purchase is granted once.
 * The caller must already have verified that `paymentId` really was paid against `order`.
 */
export async function settlePayment(order: PaymentOrder, paymentId: string): Promise<Settlement> {
  const result = await grantOrRecoverFromEmailClash(order, paymentId);
  const settled = result.order;
  // Only the call that actually granted the purchase sends the receipt; repeats and races find it done.
  if (result.kind === "granted") sendReceiptInBackground(settled.id);

  if (settled.razorpayPaymentId && settled.razorpayPaymentId !== paymentId) await refundSurplusPayment(settled, paymentId);

  switch (settled.status) {
    case "FULFILLED":
      return { status: "FULFILLED", shopkeeperId: settled.shopkeeperId as string, fulfilledAt: settled.fulfilledAt as Date, firstTime: result.kind === "granted" };
    case "NEEDS_REFUND":
      return refundOrder(settled);
    case "REFUNDED":
      return { status: "REFUNDED", reason: settled.failureReason ?? "", paymentId: settled.razorpayPaymentId ?? paymentId };
    case "CREATED":
      throw new Error(`Order ${settled.id} is still unpaid after settlement`);
  }
}

// ─── Browser confirmation ─────────────────────────────────────────────────────

/** Who is confirming: the sign-up (by draft) or a signed-in shopkeeper. */
export type PaymentOwner = { draftId: string } | { shopkeeperId: string };

/** Once an account exists, a repeat confirmation may only hand out a fresh session for this long. */
const SESSION_REISSUE_WINDOW_MS = 24 * 60 * 60 * 1000;

const refundedMessage = (what: string, reason: string) =>
  `We couldn't complete your ${what} (${reason}). Your payment has been refunded; it usually reaches your account within 5 to 7 working days.`;
const refundPendingMessage = (what: string, reason: string, paymentId: string) =>
  `We couldn't complete your ${what} (${reason}). Your payment is being refunded automatically. If it hasn't arrived within a week, contact us with payment id ${paymentId}.`;

/**
 * Confirms a payment the browser reports. The signature proves Razorpay really paid that
 * order; the order row proves what it was for and who for. Nothing the client sends decides
 * the plan or the amount.
 */
export async function confirmClientPayment(input: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
  owner: PaymentOwner;
}): Promise<{ shopkeeperId: string; firstTime: boolean }> {
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature, owner } = input;

  if (!verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature)) {
    paymentVerifications.inc({ outcome: "failure" });
    recordPaymentFailure();
    throw new PaymentError(400, "Payment verification failed. If money was taken, do not pay again: contact us with your payment id.");
  }

  const order = await prisma.paymentOrder.findUnique({ where: { razorpayOrderId } });
  const registering = "draftId" in owner;
  const belongs = order && (registering ? order.purpose === "REGISTRATION" && order.draftId === owner.draftId : order.purpose === "RENEWAL" && order.shopkeeperId === owner.shopkeeperId);
  if (!order || !belongs) {
    paymentVerifications.inc({ outcome: "failure" });
    throw new PaymentError(400, registering ? "This payment does not belong to this registration." : "This payment does not belong to your account.");
  }

  // One payment buys one order. (Razorpay's signature already ties a payment to its order; this is the second lock.)
  const usedElsewhere = await prisma.paymentOrder.findUnique({ where: { razorpayPaymentId }, select: { id: true } });
  if (usedElsewhere && usedElsewhere.id !== order.id) {
    paymentVerifications.inc({ outcome: "failure" });
    throw new PaymentError(409, "This payment has already been used.");
  }

  const what = registering ? "registration" : "renewal";
  const settlement = await settlePayment(order, razorpayPaymentId);
  switch (settlement.status) {
    case "FULFILLED":
      if (registering && !settlement.firstTime && Date.now() - settlement.fulfilledAt.getTime() > SESSION_REISSUE_WINDOW_MS) {
        throw new PaymentError(409, "Your registration is already complete. Please log in.");
      }
      paymentVerifications.inc({ outcome: "success" });
      return { shopkeeperId: settlement.shopkeeperId, firstTime: settlement.firstTime };
    case "REFUNDED":
      paymentVerifications.inc({ outcome: "refunded" });
      throw new PaymentError(409, refundedMessage(what, settlement.reason));
    case "NEEDS_REFUND":
      paymentVerifications.inc({ outcome: "refund_pending" });
      throw new PaymentError(409, refundPendingMessage(what, settlement.reason, razorpayPaymentId));
  }
}

// ─── Refund retries ───────────────────────────────────────────────────────────

const REFUND_RETRY_AFTER_MS = 30 * 60 * 1000;
const REFUND_RETRY_BATCH = 20;

/** Tries again for refunds that failed earlier. Run by the daily maintenance job; returns how many went through. */
export async function retryPendingRefunds(now = new Date()): Promise<number> {
  const stuck = await prisma.paymentOrder.findMany({
    where: { status: "NEEDS_REFUND", razorpayPaymentId: { not: null }, updatedAt: { lt: new Date(now.getTime() - REFUND_RETRY_AFTER_MS) } },
    orderBy: { updatedAt: "asc" },
    take: REFUND_RETRY_BATCH,
  });
  const results = await Promise.all(stuck.map((order) => refundOrder(order)));
  return results.filter((r) => r.status === "REFUNDED").length;
}
