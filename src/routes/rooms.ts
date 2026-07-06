/**
 * routes/rooms.ts — Customer-facing room discovery routes.
 *
 *   GET /api/rooms/discover  — Paginated room list with distance + trending
 */

import { Router } from "express";
import { requireCustomerAuth } from "../middleware/customerAuth.js";
import { requireAnyAuth } from "../middleware/anyAuth.js";
import {
  discoverRooms,
  mapPins,
  getRoomDetails,
  getRoomMembers,
} from "../controllers/rooms.controller.js";

export const roomsRouter = Router();

/** Discover nearby rooms. Auth: customer JWT. */
roomsRouter.get("/discover", requireCustomerAuth, discoverRooms);

/** Lightweight map pins (with optional bbox). Auth: customer JWT. */
roomsRouter.get("/map-pins", requireCustomerAuth, mapPins);

/** Room chat bootstrap data. Auth: customer or shopkeeper JWT. */
roomsRouter.get("/:roomId", requireAnyAuth, getRoomDetails);

/** Room member list, for the shared Room Info view. Auth: customer or shopkeeper JWT. */
roomsRouter.get("/:roomId/members", requireAnyAuth, getRoomMembers);
