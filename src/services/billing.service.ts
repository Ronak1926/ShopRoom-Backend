/**
 * services/billing.service.ts — What a shopkeeper's plan is, whether it is
 * still running, and renewing it.
 *
 * Renewal is the same payment flow as registration, with the same guarantees:
 * the order must be one WE created for THIS shopkeeper (the receipt names them),
 * its amount must be the plan's price, and the payment must never have been used
 * before (the ledger's unique ids). An expired plan stops notification sends and
 * schedules, never access to the account, its data or the billing screen.
 */

import { Prisma } from "../generated/client.js";
import { prisma } from "../database/prisma.js";
import { createRazorpayOrder, fetchOrderSummary, verifyPaymentSignature, type RazorpayOrderResult } from "../lib/razorpay.js";
import { NotificationError } from "../utils/notificationError.js";
import { PLANS, PLAN_IDS, isPlanId, planEndsAt, type PlanId } from "./plans.js";

export interface BillingView {
  planType: string;
  planExpiresAt: string;
  active: boolean;
  /** Whole days left, 0 when expired. */
  daysLeft: number;
  plans: { id: PlanId; label: string; priceInr: number; days: number }[];
  payments: { id: string; purpose: "REGISTRATION" | "RENEWAL"; planType: string; amountInr: number; paidAt: string }[];
}

/** Ties a Razorpay order to the shopkeeper it was made for. */
export function renewalReceipt(shopkeeperId: string): string {
  return `rn_${shopkeeperId}`;
}

export function isPlanActive(planExpiresAt: Date, now = new Date()): boolean {
  return planExpiresAt.getTime() > now.getTime();
}

/** The plan facts the notification screens need (cheaper than the full billing view). */
export async function getPlanStatus(shopkeeperId: string): Promise<{ planType: string; planExpiresAt: string; active: boolean }> {
  const owner = await prisma.shopkeeper.findUniqueOrThrow({ where: { id: shopkeeperId }, select: { planType: true, planExpiresAt: true } });
  return { planType: owner.planType, planExpiresAt: owner.planExpiresAt.toISOString(), active: isPlanActive(owner.planExpiresAt) };
}

export async function getBilling(shopkeeperId: string): Promise<BillingView> {
  const [owner, payments] = await Promise.all([
    prisma.shopkeeper.findUniqueOrThrow({ where: { id: shopkeeperId }, select: { planType: true, planExpiresAt: true } }),
    prisma.planPayment.findMany({
      where: { shopkeeperId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, purpose: true, planType: true, amount: true, createdAt: true },
    }),
  ]);
  const now = new Date();
  const msLeft = Math.max(0, owner.planExpiresAt.getTime() - now.getTime());
  return {
    planType: owner.planType,
    planExpiresAt: owner.planExpiresAt.toISOString(),
    active: isPlanActive(owner.planExpiresAt, now),
    daysLeft: Math.ceil(msLeft / 86_400_000),
    plans: PLAN_IDS.map((id) => ({ id, label: PLANS[id].label, priceInr: PLANS[id].amount / 100, days: PLANS[id].days })),
    payments: payments.map((p) => ({
      id: p.id,
      purpose: p.purpose,
      planType: p.planType,
      amountInr: p.amount / 100,
      paidAt: p.createdAt.toISOString(),
    })),
  };
}

export async function createRenewalOrder(shopkeeperId: string, planType: unknown): Promise<RazorpayOrderResult> {
  if (!isPlanId(planType)) throw NotificationError.badRequest("Choose a plan");
  return createRazorpayOrder(PLANS[planType].amount, renewalReceipt(shopkeeperId));
}

export interface RenewalPayment {
  planType: unknown;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

export async function verifyRenewal(shopkeeperId: string, payment: RenewalPayment): Promise<BillingView> {
  if (!isPlanId(payment.planType)) throw NotificationError.badRequest("Choose a plan");
  const planType = payment.planType;

  if (!verifyPaymentSignature(payment.razorpayOrderId, payment.razorpayPaymentId, payment.razorpaySignature)) {
    throw NotificationError.badRequest("Payment verification failed. If money was taken, contact support with your payment id.");
  }

  // The signature only proves that SOME order was paid: check it was this shopkeeper's, at this plan's price.
  const order = await fetchOrderSummary(payment.razorpayOrderId);
  if (order.receipt !== renewalReceipt(shopkeeperId)) {
    throw NotificationError.badRequest("This payment does not belong to your account");
  }
  if (order.amount !== null && order.amount !== PLANS[planType].amount) {
    throw NotificationError.badRequest("The amount paid does not match the selected plan");
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Lock the row so two renewals landing together extend the plan one after the other.
      const [owner] = await tx.$queryRaw<{ planExpiresAt: Date }[]>`SELECT "planExpiresAt" FROM "Shopkeeper" WHERE "id" = ${shopkeeperId} FOR UPDATE`;
      if (!owner) throw NotificationError.notFound("Account not found");
      await tx.planPayment.create({
        data: {
          shopkeeperId,
          purpose: "RENEWAL",
          planType,
          amount: PLANS[planType].amount,
          razorpayOrderId: payment.razorpayOrderId,
          razorpayPaymentId: payment.razorpayPaymentId,
        },
      });
      await tx.shopkeeper.update({
        where: { id: shopkeeperId },
        data: { planType, planExpiresAt: planEndsAt(planType, owner.planExpiresAt) },
      });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new NotificationError(409, "This payment has already been used");
    }
    throw err;
  }
  return getBilling(shopkeeperId);
}
