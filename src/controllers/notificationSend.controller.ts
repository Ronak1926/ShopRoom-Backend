import type { Request, Response } from "express";
import { z } from "zod";
import { parseBody } from "../utils/validate.js";
import { SendNotificationSchema } from "../schemas/notificationSendRequest.schema.js";
import { sendNotification } from "../services/notificationSend.service.js";
import { listSends } from "../services/notificationHistory.service.js";
import { handleControllerError } from "./notificationResponse.js";

const HistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
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
