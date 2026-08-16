/**
 * services/notificationAnimation.service.ts — Reusable animation catalog.
 * The DB owns identity + safe params; the client owns the Framer Motion impl.
 */

import { prisma } from "../database/prisma.js";
import { meetsRequiredPlan } from "./notificationPlan.service.js";

type AnimationCategory = "ENTRY" | "ATTENTION" | "CLICK" | "EXIT";

export async function listAnimations(
  planType: string | null | undefined,
  category?: AnimationCategory,
) {
  const rows = await prisma.notificationAnimation.findMany({
    where: { isActive: true, ...(category ? { category } : {}) },
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
    select: {
      id: true,
      slug: true,
      name: true,
      type: true,
      category: true,
      configSchema: true,
      requiredPlan: true,
      previewUrl: true,
    },
  });

  // Annotate each with plan availability rather than hiding locked ones, so the
  // editor can show a lock badge (backend stays authoritative on use).
  return rows.map((a) => ({
    ...a,
    locked: !meetsRequiredPlan(planType, a.requiredPlan),
  }));
}
