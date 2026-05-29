/**
 * routes/rooms.ts — Customer-facing room discovery routes.
 *
 *   GET /api/rooms/discover  — Paginated room list with distance + trending
 */

import { Router } from "express";
import { requireCustomerAuth } from "../middleware/customerAuth.js";
import { discoverRooms } from "../controllers/rooms.controller.js";

export const roomsRouter = Router();

/** Discover nearby rooms. Auth: customer JWT. */
roomsRouter.get("/discover", requireCustomerAuth, discoverRooms);
