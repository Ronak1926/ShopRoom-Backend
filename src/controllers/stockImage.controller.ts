/**
 * controllers/stockImage.controller.ts — HTTP layer for stock-photo search
 * (Stock tab in the Notification Studio; Product tab reuses this too).
 */

import type { Request, Response } from "express";
import { StockImageSearchQuerySchema } from "../schemas/notificationRequests.schema.js";
import { searchStockImages as searchStockImagesService } from "../services/stockImage.service.js";
import { handleControllerError } from "./notificationResponse.js";

// GET /api/notifications/stock-images
export async function searchStockImages(req: Request, res: Response): Promise<void> {
  const parsed = StockImageSearchQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid query" });
    return;
  }
  try {
    const result = await searchStockImagesService(parsed.data);
    res.json({ data: result });
  } catch (err) {
    handleControllerError(res, err, "Failed to search stock images");
  }
}
