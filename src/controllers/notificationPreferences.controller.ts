/**
 * controllers/notificationPreferences.controller.ts — Read and save the
 * shopkeeper's notification preferences (see the service for what is enforced).
 */

import type { Request, Response } from "express";
import { PreferencesInputSchema, getPreferences, savePreferences } from "../services/notificationPreferences.service.js";
import { handleControllerError } from "./notificationResponse.js";

// GET /api/notifications/preferences — { data: null } until the shopkeeper has saved some
export async function getPreferencesHandler(req: Request, res: Response): Promise<void> {
  try {
    res.set("Cache-Control", "no-store");
    res.json({ data: await getPreferences(req.shopkeeperId!) });
  } catch (err) {
    handleControllerError(res, err, "Failed to load preferences");
  }
}

// PUT /api/notifications/preferences
export async function savePreferencesHandler(req: Request, res: Response): Promise<void> {
  const parsed = PreferencesInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid preferences" });
    return;
  }
  try {
    await savePreferences(req.shopkeeperId!, parsed.data);
    res.json({ data: parsed.data, message: "Preferences saved" });
  } catch (err) {
    handleControllerError(res, err, "Failed to save preferences");
  }
}
