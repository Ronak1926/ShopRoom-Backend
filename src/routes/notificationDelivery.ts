/**
 * routes/notificationDelivery.ts — Customer-facing notification endpoints:
 * reading a sent push's design, and devices reporting what they did with it.
 * Mounted at the same /api/notifications prefix as notificationsRouter, but as
 * its own Router instance since that one is globally shopkeeper-only.
 */

import { Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { requireCustomerAuth } from "../middleware/customerAuth.js";
import {
  getFeedHandler,
  getSendDesignHandler,
  recordReceiptHandler,
} from "../controllers/notificationDelivery.controller.js";

/** Unauthenticated, so capped per IP; generous enough for a shared office/mall network. */
const receiptLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
  message: { message: "Too many requests." },
  standardHeaders: true,
  legacyHeaders: false,
});

export const notificationDeliveryRouter = Router();

notificationDeliveryRouter.get("/feed", requireCustomerAuth, getFeedHandler);
notificationDeliveryRouter.get("/sends/:id/design", requireCustomerAuth, getSendDesignHandler);
notificationDeliveryRouter.post("/receipts", receiptLimiter, recordReceiptHandler);
