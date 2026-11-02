import type { Request, Response } from "express";
import { z } from "zod";
import { parseBody } from "../utils/validate.js";
import { SendNotificationSchema } from "../schemas/notificationSendRequest.schema.js";
import { sendNotification } from "../services/notificationSend.service.js";
import { HISTORY_OUTCOMES, HISTORY_SORTS, listSends } from "../services/notificationHistory.service.js";
import { MAX_ANALYTICS_DAYS, getAnalytics } from "../services/notificationAnalytics.service.js";
import { handleControllerError } from "./notificationResponse.js";

const HistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  outcome: z.enum(HISTORY_OUTCOMES).default("all"),
  sort: z.enum(HISTORY_SORTS).default("latest"),
  q: z.string().trim().max(100).optional(),
  days: z.coerce.number().int().min(1).max(MAX_ANALYTICS_DAYS).optional(),
});

const AnalyticsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(MAX_ANALYTICS_DAYS).default(7),
});

// POST /api/notifications/send
export async function sendNotificationHandler(req: Request, res: Response): Promise<void> {
  const parsed = parseBody(req, SendNotificationSchema);
  if (!parsed.ok) {
    res.status(400).json({ message: "Invalid input" });
    return;
  }
  try {
    const result = await sendNotification(req.shopkeeperId!, parsed.data);
    res.status(201).json({ data: result, message: "Notification sent" });
  } catch (err) {
    handleControllerError(res, err, "Failed to send notification");
  }
}

// GET /api/notifications/sends
export async function listSendsHandler(req: Request, res: Response): Promise<void> {
  const query = HistoryQuerySchema.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ message: "Invalid input" });
    return;
  }
  try {
    const result = await listSends(req.shopkeeperId!, query.data);
    res.set("Cache-Control", "private, max-age=15");
    res.json({ data: result });
  } catch (err) {
    handleControllerError(res, err, "Failed to load send history");
  }
}

// GET /api/notifications/analytics?days=7
export async function analyticsHandler(req: Request, res: Response): Promise<void> {
  const query = AnalyticsQuerySchema.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ message: "Invalid input" });
    return;
  }
  try {
    const result = await getAnalytics(req.shopkeeperId!, query.data.days);
    res.set("Cache-Control", "private, max-age=15");
    res.json({ data: result });
  } catch (err) {
    handleControllerError(res, err, "Failed to load analytics");
  }
}
