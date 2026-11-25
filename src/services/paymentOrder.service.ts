/**
 * services/paymentOrder.service.ts — Starting a payment: checking the buyer may pay, and
 * creating the Razorpay order plus our own PaymentOrder row for it.
 *
 * The row records what the order is for (which draft, or which shopkeeper), which plan and
 * how many paise. From then on that row, not the browser and not a receipt string, decides
 * what a payment against the order buys.
 */

import { randomUUID } from "node:crypto";
import { prisma } from "../database/prisma.js";
import { createRazorpayOrder, isMockOrderId, publicKeyId, PaymentProviderError, type RazorpayOrderResult } from "../lib/razorpay.js";
import { PaymentError } from "../utils/paymentError.js";
import { isPlanActive } from "./billing.service.js";
import { PLANS, isPlanId, planRank, type PlanId } from "./plans.js";

/**
 * An unpaid order for the same buyer and plan is handed out again for this long, so a double
 * click, a refresh or a re-opened checkout never piles up orders at Razorpay.
 */
const REUSE_WINDOW_MS = 2 * 60 * 60 * 1000;

type Intent =
  | { purpose: "REGISTRATION"; draftId: string; planType: PlanId }
  | { purpose: "RENEWAL"; shopkeeperId: string; planType: PlanId };

function parsePlan(planType: unknown): PlanId {
  if (!isPlanId(planType)) throw new PaymentError(400, "Choose a plan");
  return planType;
}

/** Razorpay trouble is not the buyer's fault, and the message says so. */
function asPaymentError(err: unknown): never {
  if (err instanceof PaymentProviderError) throw new PaymentError(err.retryable ? 503 : 502, err.message);
  throw err;
}

async function createCheckoutOrder(intent: Intent): Promise<RazorpayOrderResult> {
  const buyer = intent.purpose === "REGISTRATION" ? { draftId: intent.draftId } : { shopkeeperId: intent.shopkeeperId };

  const reusable = await prisma.paymentOrder.findFirst({
    where: { ...buyer, purpose: intent.purpose, planType: intent.planType, status: "CREATED", createdAt: { gte: new Date(Date.now() - REUSE_WINDOW_MS) } },
    orderBy: { createdAt: "desc" },
    select: { razorpayOrderId: true, amount: true },
  });
  if (reusable) {
    return {
      orderId: reusable.razorpayOrderId,
      amount: reusable.amount,
      currency: "INR",
      keyId: publicKeyId(),
      ...(isMockOrderId(reusable.razorpayOrderId) ? { mock: true } : {}),
    };
  }

  // Our id doubles as the Razorpay receipt (40 characters at most).
  const id = `po_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const amount = PLANS[intent.planType].amount;
  let order: RazorpayOrderResult;
  try {
    order = await createRazorpayOrder({ amount, receipt: id, notes: { purpose: intent.purpose, plan: intent.planType } });
  } catch (err) {
    asPaymentError(err);
  }

  // An order Razorpay made that we fail to record can never be paid: the browser only learns its id from us.
  await prisma.paymentOrder.create({
    data: { id, razorpayOrderId: order.orderId, purpose: intent.purpose, planType: intent.planType, amount, ...buyer },
  });
  return order;
}

/** Sign-up payment: the draft must be real, phone-verified, and its email still free. */
export async function createRegistrationOrder(draftId: string, planType: unknown): Promise<RazorpayOrderResult> {
  const plan = parsePlan(planType);

  const draft = await prisma.shopkeeperDraft.findUnique({ where: { id: draftId }, select: { email: true, phoneVerified: true, expiresAt: true } });
  if (!draft) {
    // The webhook may have finished this registration while the person was away from the page.
    const done = await prisma.paymentOrder.findFirst({ where: { draftId, status: "FULFILLED" }, select: { id: true } });
    if (done) throw new PaymentError(409, "Your registration is already complete. Please log in.");
    throw new PaymentError(400, "Your sign-up session was not found. Please start again.");
  }
  if (draft.expiresAt < new Date()) throw new PaymentError(400, "Your sign-up session expired. Please start again.");
  if (!draft.phoneVerified) throw new PaymentError(400, "Verify your phone number before paying.");

  // Better to say so now than after the money has moved.
  if (await prisma.shopkeeper.findUnique({ where: { email: draft.email }, select: { id: true } })) {
    throw new PaymentError(409, "An account with this email already exists. Please log in instead.");
  }
  return createCheckoutOrder({ purpose: "REGISTRATION", draftId, planType: plan });
}

const END_DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });

/**
 * Renewal payment for a signed-in shopkeeper.
 *
 * A purchase replaces the plan type at once but stacks its days after the current end, so buying a
 * lower plan while a higher one is running would turn the higher days already paid for into lower
 * ones. That is refused until the higher plan ends; extending it or upgrading is always fine, and
 * so is any plan once the current one has expired. (An order that was already open, or paid in
 * another tab, still settles: money that has moved is never refused.)
 */
export async function createRenewalOrder(shopkeeperId: string, planType: unknown): Promise<RazorpayOrderResult> {
  const plan = parsePlan(planType);
  const owner = await prisma.shopkeeper.findUnique({ where: { id: shopkeeperId }, select: { planType: true, planExpiresAt: true } });
  if (owner && isPlanActive(owner.planExpiresAt) && planRank(plan) < planRank(owner.planType)) {
    const current = isPlanId(owner.planType) ? PLANS[owner.planType].label : "current";
    throw new PaymentError(
      409,
      `Your ${current} plan runs until ${END_DATE.format(owner.planExpiresAt)}. You can switch to ${PLANS[plan].label} after it ends; until then you can extend it or upgrade.`,
    );
  }
  return createCheckoutOrder({ purpose: "RENEWAL", shopkeeperId, planType: plan });
}
