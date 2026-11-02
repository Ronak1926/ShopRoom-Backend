/**
 * routes/notifications.ts — Customizable-notification HTTP routes.
 * All handler logic lives in the notification* controllers. Every route is
 * shopkeeper-authenticated.
 *
 * Route map (mounted at /api/notifications):
 *   Designs
 *     POST   /designs                 — create blank (or from templateId)
 *     GET    /designs                 — list own designs
 *     GET    /designs/:id             — fetch design + current version
 *     PATCH  /designs/:id             — autosave design JSON
 *     POST   /designs/:id/duplicate   — duplicate
 *     POST   /designs/:id/versions    — snapshot an explicit version
 *     POST   /designs/:id/archive     — archive
 *     POST   /designs/:id/restore     — restore
 *   Assets
 *     POST   /assets                  — upload image asset
 *     GET    /assets                  — list own assets
 *     GET    /stock-images            — search Pexels/Unsplash stock photos
 *   Templates
 *     GET    /templates               — paginated catalog (categoryId, q, sort, page, limit)
 *     GET    /templates/:id           — fetch a template
 *     POST   /templates/:id/use       — clone into an owned design
 *   Catalog
 *     GET    /animations              — list animations (plan-annotated)
 *     GET    /categories              — list notification types
 *     GET    /capabilities            — plan-derived feature flags
 *   Validation
 *     POST   /validate-design         — validate a design document
 *   Send
 *     POST   /send                    — dispatch a design to an audience as a push notification
 *     GET    /sends                   — send history with delivery analytics
 *   Schedules
 *     POST   /schedules               — queue a send for later (once or recurring)
 *     GET    /schedules               — list schedules (?state=upcoming|completed)
 *     PATCH  /schedules/:id           — pause or resume
 *     DELETE /schedules/:id           — cancel
 */

import { Router } from "express";
import { getPreferencesHandler, savePreferencesHandler } from "../controllers/notificationPreferences.controller.js";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { requireShopkeeperAuth } from "../middleware/shopkeeperAuth.js";
import {
  createDesign,
  listDesigns,
  getDesign,
  autosaveDesign,
  duplicateDesign,
  createDesignVersion,
  archiveDesign,
  restoreDesign,
  validateDesign,
} from "../controllers/notificationDesign.controller.js";
import {
  listTemplates,
  getTemplate,
  useTemplate,
} from "../controllers/notificationTemplate.controller.js";
import { listAnimations } from "../controllers/notificationAnimation.controller.js";
import {
  uploadAsset,
  listAssets,
} from "../controllers/notificationAsset.controller.js";
import { searchStockImages } from "../controllers/stockImage.controller.js";
import {
  listCategories,
  getCapabilities,
} from "../controllers/notificationCategory.controller.js";
import {
  sendNotificationHandler,
  analyticsHandler,
  listSendsHandler,
} from "../controllers/notificationSend.controller.js";
import {
  createScheduleHandler,
  listSchedulesHandler,
  updateScheduleStatusHandler,
  cancelScheduleHandler,
} from "../controllers/notificationSchedule.controller.js";

// ── Rate limiters ───────────────────────────────────────────────────────────────

/** Autosave fires often; keep it generous but bounded per shopkeeper. */
const autosaveLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  keyGenerator: (req) => req.shopkeeperId ?? ipKeyGenerator(req.ip ?? ""),
  message: { message: "Too many save requests. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
});

/** Uploads hit Cloudinary — tighter cap. */
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: (req) => req.shopkeeperId ?? ipKeyGenerator(req.ip ?? ""),
  message: { message: "Too many uploads. Please wait a minute." },
  standardHeaders: true,
  legacyHeaders: false,
});

/** Stock search hits third-party provider rate limits — keep it bounded. */
const stockImageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.shopkeeperId ?? ipKeyGenerator(req.ip ?? ""),
  message: { message: "Too many searches. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
});

/** Sending fans out to every room member's devices — keep it tightly bounded. */
const sendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.shopkeeperId ?? ipKeyGenerator(req.ip ?? ""),
  message: { message: "Too many sends. Please wait a minute." },
  standardHeaders: true,
  legacyHeaders: false,
});

/** Pausing, resuming and cancelling schedules is cheap — kept apart from sendLimiter so managing schedules never eats into the allowance for sending. */
const scheduleLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.shopkeeperId ?? ipKeyGenerator(req.ip ?? ""),
  message: { message: "Too many schedule changes. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Routes ────────────────────────────────────────────────────────────────────

export const notificationsRouter = Router();

// Every notification endpoint requires a shopkeeper session.
notificationsRouter.use(requireShopkeeperAuth);

// Designs
notificationsRouter.post("/designs", createDesign);
notificationsRouter.get("/designs", listDesigns);
notificationsRouter.get("/designs/:id", getDesign);
notificationsRouter.patch("/designs/:id", autosaveLimiter, autosaveDesign);
notificationsRouter.post("/designs/:id/duplicate", duplicateDesign);
notificationsRouter.post("/designs/:id/versions", createDesignVersion);
notificationsRouter.post("/designs/:id/archive", archiveDesign);
notificationsRouter.post("/designs/:id/restore", restoreDesign);

// Assets
notificationsRouter.post("/assets", uploadLimiter, uploadAsset);
notificationsRouter.get("/assets", listAssets);
notificationsRouter.get("/stock-images", stockImageLimiter, searchStockImages);

// Templates
notificationsRouter.get("/templates", listTemplates);
notificationsRouter.get("/templates/:id", getTemplate);
notificationsRouter.post("/templates/:id/use", useTemplate);

// Catalog
notificationsRouter.get("/animations", listAnimations);
notificationsRouter.get("/categories", listCategories);
notificationsRouter.get("/capabilities", getCapabilities);
notificationsRouter.get("/preferences", getPreferencesHandler);
notificationsRouter.put("/preferences", scheduleLimiter, savePreferencesHandler);

// Validation
notificationsRouter.post("/validate-design", validateDesign);

// Send
notificationsRouter.post("/send", sendLimiter, sendNotificationHandler);
notificationsRouter.get("/sends", listSendsHandler);
notificationsRouter.get("/analytics", analyticsHandler);

// Schedules
notificationsRouter.post("/schedules", scheduleLimiter, createScheduleHandler);
notificationsRouter.get("/schedules", listSchedulesHandler);
notificationsRouter.patch("/schedules/:id", scheduleLimiter, updateScheduleStatusHandler);
notificationsRouter.delete("/schedules/:id", scheduleLimiter, cancelScheduleHandler);
