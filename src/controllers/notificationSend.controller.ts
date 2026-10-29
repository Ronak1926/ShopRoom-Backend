import type { Request, Response } from "express";
import { parseBody } from "../utils/validate.js";
import { SendNotificationSchema } from "../schemas/notificationSendRequest.schema.js";
import { sendNotification } from "../services/notificationSend.service.js";
import { handleControllerError } from "./notificationResponse.js";

// POST /api/notifications/send
export async function sendNotificationHandler(req: Request, res: Response): Promise<void> {
  const parsed = parseBody(req, SendNotificationSchema);
  if (!parsed.ok) {
    res.status(400).json({ message: "Invalid input" });
    return;
  }
  if (parsed.data.audience.mode !== "ROOM_MEMBERS") {
    res.status(400).json({
      message: "This audience isn't available yet — send to Room Members for now.",
    });
    return;
  }
  try {
    const result = await sendNotification(req.shopkeeperId!, parsed.data);
    res.status(201).json({ data: result, message: "Notification sent" });
  } catch (err) {
    handleControllerError(res, err, "Failed to send notification");
  }
}
