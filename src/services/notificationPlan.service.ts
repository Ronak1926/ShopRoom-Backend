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
  /**
   * How far beyond the room a send may reach, in km. 0 means room members
   * only: no customers selected by distance at all.
   */
  maxRadiusKm: number;
  CUSTOM_TEMPLATE: boolean;
  ADVANCED_TEMPLATE_EDITING: boolean;
  CUSTOM_ANIMATION: boolean;
}

const PLAN_RANK: Record<PlanType, number> = { "1m": 1, "2m": 2, "3m": 3 };

const CAPABILITIES: Record<PlanType, PlanCapabilities> = {
  "1m": {
    dailyNotificationLimit: 1,
    maxRadiusKm: 0,
    CUSTOM_TEMPLATE: false,
    ADVANCED_TEMPLATE_EDITING: false,
    CUSTOM_ANIMATION: false,
  },
  "2m": {
    dailyNotificationLimit: 2,
    maxRadiusKm: 5,
    CUSTOM_TEMPLATE: true,
    ADVANCED_TEMPLATE_EDITING: true,
    CUSTOM_ANIMATION: false,
  },
  "3m": {
    dailyNotificationLimit: 4,
    maxRadiusKm: 10,
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

/**
 * Why an audience is outside what the plan allows, or null when it is fine.
 * `reachesNearby` is whether the send goes beyond room members to anyone
 * selected by distance (every audience kind except ROOM_MEMBERS).
 */
export function audienceViolation(
  planType: string | null | undefined,
  reachesNearby: boolean,
  radiusKm: number | null | undefined,
): string | null {
  if (!reachesNearby) return null;
  const max = getPlanCapabilities(planType).maxRadiusKm;
  if (max === 0) {
    return "Your 1 Month plan sends to your room members only. Upgrade to reach customers nearby.";
  }
  if (!radiusKm || radiusKm > max) {
    return `Your plan reaches customers up to ${max} km away. Choose ${max} km or less, or upgrade for a wider reach.`;
  }
  return null;
}
