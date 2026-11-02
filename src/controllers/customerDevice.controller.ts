import type { Request, Response } from "express";
import { parseBody } from "../utils/validate.js";
import {
  RegisterDeviceSchema,
  UnregisterDeviceSchema,
} from "../schemas/customerDevice.schema.js";
import { registerDevice, unregisterDevice } from "../services/customerDevice.service.js";
import { logger } from "../lib/logger.js";

// POST /api/customers/me/devices
export async function registerDeviceHandler(req: Request, res: Response): Promise<void> {
  const parsed = parseBody(req, RegisterDeviceSchema);
  if (!parsed.ok) {
    res.status(400).json({ message: "Invalid device registration" });
    return;
  }
  try {
    const device = await registerDevice(req.customerId!, {
      ...parsed.data,
      userAgent: req.header("user-agent"),
    });
    res.status(201).json({ data: device, message: "Device registered" });
  } catch (err) {
    logger.error("Device registration error", err);
    res.status(500).json({ message: "Failed to register device" });
  }
}

// DELETE /api/customers/me/devices
export async function unregisterDeviceHandler(req: Request, res: Response): Promise<void> {
  const parsed = parseBody(req, UnregisterDeviceSchema);
  if (!parsed.ok) {
    res.status(400).json({ message: "Invalid request" });
    return;
  }
  try {
    await unregisterDevice(req.customerId!, parsed.data.fcmToken);
    res.json({ message: "Device unregistered" });
  } catch (err) {
    logger.error("Device unregistration error", err);
    res.status(500).json({ message: "Failed to unregister device" });
  }
}
