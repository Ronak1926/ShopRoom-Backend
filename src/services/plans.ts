/**
 * services/plans.ts — What each subscription plan costs and how long it runs.
 * The single source of truth: registration, renewal, the billing screen and the
 * order-versus-plan check all read it.
 */

export type PlanId = "1m" | "2m" | "3m";

export interface PlanInfo {
  id: PlanId;
  label: string;
  /** Paise, as Razorpay expects. */
  amount: number;
  days: number;
}

export const PLANS: Record<PlanId, PlanInfo> = {
  "1m": { id: "1m", label: "1 Month", amount: 39_900, days: 30 },
  "2m": { id: "2m", label: "2 Months", amount: 59_900, days: 60 },
  "3m": { id: "3m", label: "3 Months", amount: 89_900, days: 90 },
};

export const PLAN_IDS = Object.keys(PLANS) as PlanId[];

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === "string" && value in PLANS;
}

export const DAY_MS = 24 * 60 * 60 * 1000;

/** When a plan bought now ends, given when the current one ends (unused time carries over). */
export function planEndsAt(planType: PlanId, currentEnd: Date | null, now = new Date()): Date {
  const start = currentEnd && currentEnd.getTime() > now.getTime() ? currentEnd : now;
  return new Date(start.getTime() + PLANS[planType].days * DAY_MS);
}
