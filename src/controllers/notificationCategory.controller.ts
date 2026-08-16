/**
 * controllers/notificationCategory.controller.ts — Catalog + plan capabilities
 * that the studio needs to populate its type picker and lock gated features.
 */

import type { Request, Response } from "express";
import { listCategories as listCategoriesService } from "../services/notificationCategory.service.js";
import {
  getShopkeeperPlan,
  getPlanCapabilities,
} from "../services/notificationPlan.service.js";
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
    const planType = await getShopkeeperPlan(req.shopkeeperId!);
    res.json({ data: { planType, capabilities: getPlanCapabilities(planType) } });
  } catch (err) {
    handleControllerError(res, err, "Failed to load capabilities");
  }
}
