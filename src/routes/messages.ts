/**
 * routes/messages.ts — Route declarations for room chat history.
 * All handler logic lives in controllers/messages.controller.ts.
 * Mounted at the same "/api/rooms" prefix as routes/rooms.ts.
 */

import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { requireAnyAuth } from "../middleware/anyAuth.js";
import {
  getRoomMessages,
  postRoomMessage,
} from "../controllers/messages.controller.js";
import type { Request } from "express";

/** 20 messages per sender per 10 seconds via the REST fallback. */
const sendMessageLimiter = rateLimit({
  windowMs: 10 * 1000,
  max: 20,
  keyGenerator: (req: Request) => req.customerId ?? req.shopkeeperId ?? "anon",
  message: { message: "You're sending messages too fast. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
});

export const messagesRouter = Router();

messagesRouter.get(
  "/:roomId/messages",
  requireAnyAuth,
  getRoomMessages,
);
messagesRouter.post(
  "/:roomId/messages",
  requireAnyAuth,
  sendMessageLimiter,
  postRoomMessage,
);
