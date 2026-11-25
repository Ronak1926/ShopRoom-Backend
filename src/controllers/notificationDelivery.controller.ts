import type { Request, Response } from "express";
import { parseBody } from "../utils/validate.js";
import { ReceiptSchema } from "../schemas/notificationReceipt.schema.js";
import { getFeed, getSendDesign } from "../services/notificationDelivery.service.js";
import { recordReceipt } from "../services/notificationReceipt.service.js";
import { handleControllerError, requireIdParam } from "./notificationResponse.js";

// GET /api/notifications/sends/:id/design
export async function getSendDesignHandler(req: Request, res: Response): Promise<void> {
  try {
    const id = requireIdParam(req.params.id);
    const result = await getSendDesign(req.customerId!, id);
    res.json({ data: result });
  } catch (err) {
    handleControllerError(res, err, "Failed to fetch notification");
  }
}

// POST /api/notifications/receipts — device-reported delivered / opened / clicked.
// No login (a service worker has none); the unguessable receipt token is the
// credential, and the response never reveals whether it matched anything.
export async function recordReceiptHandler(req: Request, res: Response): Promise<void> {
  const parsed = parseBody(req, ReceiptSchema);
  if (!parsed.ok) {
    res.status(400).json({ message: "Invalid input" });
    return;
  }
  try {
    await recordReceipt(parsed.data.token, parsed.data.event);
    res.status(204).end();
  } catch (err) {
    handleControllerError(res, err, "Failed to record receipt");
  }
}

// GET /api/notifications/feed — the signed-in customer's recent notifications
export async function getFeedHandler(req: Request, res: Response): Promise<void> {
  try {
    res.set("Cache-Control", "private, no-cache");
    res.json({ data: await getFeed(req.customerId!) });
  } catch (err) {
    handleControllerError(res, err, "Failed to load notifications");
  }
}
