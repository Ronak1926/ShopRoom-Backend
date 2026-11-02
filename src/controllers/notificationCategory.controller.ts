/**
 * controllers/notificationCategory.controller.ts — Catalog + plan capabilities
 * that the studio needs to populate its type picker and lock gated features.
 */

import type { Request, Response } from "express";
import { listCategories as listCategoriesService } from "../services/notificationCategory.service.js";
import { getPlanCapabilities } from "../services/notificationPlan.service.js";
import { getPlanStatus } from "../services/billing.service.js";
import { getSendsToday } from "../services/notificationUsage.service.js";
import { handleControllerError } from "./notificationResponse.js";

// GET /api/notifications/categories
export async function listCategories(req: Request, res: Response): Promise<void> {
  try {
    const categories = await listCategoriesService();
    res.set("Cache-Control", "private, max-age=300");
    res.json({ data: categories });
  } catch (err) {
    handleControllerError(res, err, "Failed to list categories");
  }
}

// GET /api/notifications/capabilities — plan-derived feature flags + limits
export async function getCapabilities(req: Request, res: Response): Promise<void> {
  try {
    const [plan, usedToday] = await Promise.all([
      getPlanStatus(req.shopkeeperId!),
      getSendsToday(req.shopkeeperId!),
    ]);
    res.json({
      data: {
        planType: plan.planType,
        planActive: plan.active,
        planExpiresAt: plan.planExpiresAt,
        capabilities: getPlanCapabilities(plan.planType),
        usedToday,
      },
    });
  } catch (err) {
    handleControllerError(res, err, "Failed to load capabilities");
  }
}
