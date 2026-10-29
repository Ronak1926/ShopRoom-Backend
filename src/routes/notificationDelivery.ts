/**
 * routes/notificationDelivery.ts — Customer-facing read of a sent push's
 * design. Mounted at the same /api/notifications prefix as notificationsRouter,
 * but as its own Router instance since that one is globally shopkeeper-only.
 */

import { Router } from "express";
import { requireCustomerAuth } from "../middleware/customerAuth.js";
import { getSendDesignHandler } from "../controllers/notificationDelivery.controller.js";

export const notificationDeliveryRouter = Router();

notificationDeliveryRouter.get("/sends/:id/design", requireCustomerAuth, getSendDesignHandler);
