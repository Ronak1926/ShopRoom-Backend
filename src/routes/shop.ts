/**
 * routes/shop.ts — Shop & Room HTTP routes.
 *
 * Route map:
 *   GET  /api/shop/me                     — Shopkeeper: get own shop + room info
 *   GET  /api/shop/invite/:code           — Public: invite-link preview
 *   POST /api/shop/join/:code             — Customer: join room via invite code
 *   DELETE /api/shop/room/:roomId/leave   — Customer: leave a room
 */

import { Router } from "express";
import { requireShopkeeperAuth } from "../middleware/shopkeeperAuth.js";
import { requireCustomerAuth } from "../middleware/customerAuth.js";
import {
  getMyShop,
  getInvitePreview,
  joinShopRoom,
  leaveShopRoom,
} from "../controllers/shop.controller.js";

export const shopRouter = Router();

// ─── Shopkeeper-authenticated ─────────────────────────────────────────────────

/** Returns the authenticated shopkeeper's shop + room details. */
shopRouter.get("/me", requireShopkeeperAuth, getMyShop);

// ─── Public ───────────────────────────────────────────────────────────────────

/**
 * Returns a shop preview for an invite link.
 * No auth required — shown to anyone who follows a /join/:code URL.
 */
shopRouter.get("/invite/:code", getInvitePreview);

// ─── Customer-authenticated ───────────────────────────────────────────────────

/** Customer joins a shop's room via invite code. Idempotent. */
shopRouter.post("/join/:code", requireCustomerAuth, joinShopRoom);

/** Customer leaves a room. Idempotent. */
shopRouter.delete("/room/:roomId/leave", requireCustomerAuth, leaveShopRoom);
