/**
 * services/notificationCategory.service.ts — Semantic notification type catalog.
 */

import { prisma } from "../database/prisma.js";

export function listCategories() {
  return prisma.notificationCategory.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { id: true, slug: true, name: true, icon: true },
  });
}
