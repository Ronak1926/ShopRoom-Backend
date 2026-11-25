/**
 * controllers/securityEvents.controller.ts — "Recent activity" on the account: the owner's own
 * sign-ins, password changes and downloads, so something they did not do stands out.
 */

import type { Request, Response } from "express";
import { logger } from "../lib/logger.js";
import { listSecurityEvents } from "../services/securityEvent.service.js";

// GET /api/customers/me/security-events
export async function listCustomerSecurityEventsHandler(req: Request, res: Response): Promise<void> {
  try {
    res.json({ data: await listSecurityEvents("CUSTOMER", req.customerId!) });
  } catch (err) {
    logger.error("Customer security events", err);
    res.status(500).json({ message: "Could not load your recent activity." });
  }
}

// GET /api/shopkeeper/me/security-events
export async function listShopkeeperSecurityEventsHandler(req: Request, res: Response): Promise<void> {
  try {
    res.json({ data: await listSecurityEvents("SHOPKEEPER", req.shopkeeperId!) });
  } catch (err) {
    logger.error("Shopkeeper security events", err);
    res.status(500).json({ message: "Could not load your recent activity." });
  }
}
