import type { Request, Response } from "express";
import { getSendDesign } from "../services/notificationDelivery.service.js";
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
