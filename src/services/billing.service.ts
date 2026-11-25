/**
 * services/billing.service.ts — What a shopkeeper's plan is, whether it is
 * still running, and confirming a renewal payment.
 *
 * Paying works exactly like the first payment (see paymentOrder.service.ts and
 * paymentSettlement.service.ts): the order is ours and names this shopkeeper, its
 * amount and plan were fixed when it was made, and a payment is granted once, whether
 * the browser or Razorpay's webhook reports it first. An expired plan stops notification
 * sends and schedules, never access to the account, its data or the billing screen.
 */

import { prisma } from "../database/prisma.js";
import { invoiceSeller } from "../config/invoice.js";
import { confirmClientPayment } from "./paymentSettlement.service.js";
import { PLANS, PLAN_IDS, type PlanId } from "./plans.js";

export interface BillingView {
  planType: string;
  planExpiresAt: string;
  active: boolean;
  /** Whole days left, 0 when expired. */
  daysLeft: number;
  plans: { id: PlanId; label: string; priceInr: number; days: number }[];
  /** The GSTIN printed as the buyer's on new invoices. */
  gstin: string | null;
  /** True when the business has set up GST invoicing, so payments can have an invoice. */
  invoicesEnabled: boolean;
  payments: { id: string; purpose: "REGISTRATION" | "RENEWAL"; planType: string; amountInr: number; paidAt: string; refunded: boolean }[];
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
    prisma.shopkeeper.findUniqueOrThrow({ where: { id: shopkeeperId }, select: { planType: true, planExpiresAt: true, gstin: true } }),
    prisma.planPayment.findMany({
      where: { shopkeeperId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, purpose: true, planType: true, amount: true, createdAt: true, refundedAt: true },
    }),
  ]);
  const now = new Date();
  const msLeft = Math.max(0, owner.planExpiresAt.getTime() - now.getTime());
  return {
    planType: owner.planType,
    planExpiresAt: owner.planExpiresAt.toISOString(),
    active: isPlanActive(owner.planExpiresAt, now),
    daysLeft: Math.ceil(msLeft / 86_400_000),
    gstin: owner.gstin,
    invoicesEnabled: invoiceSeller() !== null,
    plans: PLAN_IDS.map((id) => ({ id, label: PLANS[id].label, priceInr: PLANS[id].amount / 100, days: PLANS[id].days })),
    payments: payments.map((p) => ({
      id: p.id,
      purpose: p.purpose,
      planType: p.planType,
      amountInr: p.amount / 100,
      paidAt: p.createdAt.toISOString(),
      refunded: p.refundedAt !== null,
    })),
  };
}

export interface RenewalPayment {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

/** Confirms a renewal the browser reports, then returns the updated billing. */
export async function verifyRenewal(shopkeeperId: string, payment: RenewalPayment): Promise<BillingView> {
  await confirmClientPayment({ ...payment, owner: { shopkeeperId } });
  return getBilling(shopkeeperId);
}
