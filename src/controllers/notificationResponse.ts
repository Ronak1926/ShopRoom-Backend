/**
 * controllers/notificationResponse.ts — Shared error mapping for notification
 * controllers. A NotificationError carries its own HTTP status; anything else
 * is logged server-side and returned as a sanitized 500.
 */

import type { Response } from "express";
import { NotificationError } from "../utils/notificationError.js";
import { safeMessage } from "./shopkeeper.controller.js";

export function handleControllerError(
  res: Response,
  err: unknown,
  fallback: string,
): void {
  if (err instanceof NotificationError) {
    res.status(err.status).json({ message: err.message });
    return;
  }
  console.error("Notification error:", (err as { message?: string })?.message);
  res.status(500).json({ message: safeMessage(err, fallback) });
}

/** Reads a required :id path param, or throws a 400 NotificationError. */
export function requireIdParam(id: unknown): string {
  if (!id || typeof id !== "string") {
    throw NotificationError.badRequest("Missing id parameter");
  }
  return id;
}
