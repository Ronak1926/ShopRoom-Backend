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
 *   Templates
 *     GET    /templates               — list ShopRoom templates
 *     GET    /templates/:id           — fetch a template
 *     POST   /templates/:id/use       — clone into an owned design
 *   Catalog
 *     GET    /animations              — list animations (plan-annotated)
 *     GET    /categories              — list notification types
 *     GET    /capabilities            — plan-derived feature flags
 *   Validation
 *     POST   /validate-design         — validate a design document
 */

import { Router } from "express";
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
import {
  listCategories,
  getCapabilities,
} from "../controllers/notificationCategory.controller.js";

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

// Templates
notificationsRouter.get("/templates", listTemplates);
notificationsRouter.get("/templates/:id", getTemplate);
notificationsRouter.post("/templates/:id/use", useTemplate);

// Catalog
notificationsRouter.get("/animations", listAnimations);
notificationsRouter.get("/categories", listCategories);
notificationsRouter.get("/capabilities", getCapabilities);

// Validation
notificationsRouter.post("/validate-design", validateDesign);
