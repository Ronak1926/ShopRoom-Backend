/**
 * controllers/notificationAsset.controller.ts — HTTP layer for image assets.
 */

import type { Request, Response } from "express";
import { parseBody } from "../utils/validate.js";
import { UploadAssetSchema } from "../schemas/notificationRequests.schema.js";
import {
  createAsset as createAssetService,
  listAssets as listAssetsService,
} from "../services/notificationAsset.service.js";
import { handleControllerError } from "./notificationResponse.js";

// POST /api/notifications/assets
export async function uploadAsset(req: Request, res: Response): Promise<void> {
  const parsed = parseBody(req, UploadAssetSchema);
  if (!parsed.ok) {
    res.status(400).json({ message: "Invalid image" });
    return;
  }
  try {
    const asset = await createAssetService(req.shopkeeperId!, parsed.data);
    res.status(201).json({ data: asset, message: "Asset uploaded" });
  } catch (err) {
    handleControllerError(res, err, "Failed to upload asset");
  }
}

// GET /api/notifications/assets
export async function listAssets(req: Request, res: Response): Promise<void> {
  try {
    const assets = await listAssetsService(req.shopkeeperId!);
    res.json({ data: assets });
  } catch (err) {
    handleControllerError(res, err, "Failed to list assets");
  }
}
