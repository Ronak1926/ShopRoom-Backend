/**
 * controllers/notificationAnimation.controller.ts — HTTP layer for the
 * animation catalog. Each item is annotated with plan availability.
 */

import type { Request, Response } from "express";
import { ListAnimationsQuerySchema } from "../schemas/notificationRequests.schema.js";
import { listAnimations as listAnimationsService } from "../services/notificationAnimation.service.js";
import { getShopkeeperPlan } from "../services/notificationPlan.service.js";
import { handleControllerError } from "./notificationResponse.js";

// GET /api/notifications/animations?category=
export async function listAnimations(req: Request, res: Response): Promise<void> {
  const parsed = ListAnimationsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid query" });
    return;
  }
  try {
    const planType = await getShopkeeperPlan(req.shopkeeperId!);
    const animations = await listAnimationsService(planType, parsed.data.category);
    res.set("Cache-Control", "private, max-age=60");
    res.json({ data: animations });
  } catch (err) {
    handleControllerError(res, err, "Failed to list animations");
  }
}
