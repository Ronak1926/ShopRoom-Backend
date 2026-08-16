/**
 * services/notificationPlan.service.ts — Plan gating for the customizer.
 *
 * The backend is authoritative on what each plan can do. Components should
 * check feature keys, not plan names (master plan §16). Plan values match the
 * Shopkeeper.planType column: "1m" | "2m" | "3m".
 */

import { prisma } from "../database/prisma.js";

export type PlanType = "1m" | "2m" | "3m";

export type NotificationFeature =
  | "CUSTOM_TEMPLATE"
  | "ADVANCED_TEMPLATE_EDITING"
  | "CUSTOM_ANIMATION";

export interface PlanCapabilities {
  dailyNotificationLimit: number;
  CUSTOM_TEMPLATE: boolean;
  ADVANCED_TEMPLATE_EDITING: boolean;
  CUSTOM_ANIMATION: boolean;
}

const PLAN_RANK: Record<PlanType, number> = { "1m": 1, "2m": 2, "3m": 3 };

const CAPABILITIES: Record<PlanType, PlanCapabilities> = {
  "1m": {
    dailyNotificationLimit: 1,
    CUSTOM_TEMPLATE: false,
    ADVANCED_TEMPLATE_EDITING: false,
    CUSTOM_ANIMATION: false,
  },
  "2m": {
    dailyNotificationLimit: 2,
    CUSTOM_TEMPLATE: true,
    ADVANCED_TEMPLATE_EDITING: true,
    CUSTOM_ANIMATION: false,
  },
  "3m": {
    dailyNotificationLimit: 4,
    CUSTOM_TEMPLATE: true,
    ADVANCED_TEMPLATE_EDITING: true,
    CUSTOM_ANIMATION: true,
  },
};

function normalizePlan(planType: string | null | undefined): PlanType {
  return planType === "2m" || planType === "3m" ? planType : "1m";
}

export function getPlanCapabilities(
  planType: string | null | undefined,
): PlanCapabilities {
  return CAPABILITIES[normalizePlan(planType)];
}

export function hasFeature(
  planType: string | null | undefined,
  feature: NotificationFeature,
): boolean {
  return getPlanCapabilities(planType)[feature];
}

/** Fetches the shopkeeper's stored plan type (used to gate catalog + features). */
export async function getShopkeeperPlan(
  shopkeeperId: string,
): Promise<string | null> {
  const sk = await prisma.shopkeeper.findUnique({
    where: { id: shopkeeperId },
    select: { planType: true },
  });
  return sk?.planType ?? null;
}

/** A resource with requiredPlan is available when the shopkeeper's plan rank
 *  is at least the required rank. A null requiredPlan is available to all. */
export function meetsRequiredPlan(
  planType: string | null | undefined,
  requiredPlan: string | null | undefined,
): boolean {
  if (!requiredPlan) return true;
  const required = PLAN_RANK[requiredPlan as PlanType];
  if (!required) return true;
  return PLAN_RANK[normalizePlan(planType)] >= required;
}
