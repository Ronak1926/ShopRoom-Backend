/**
 * controllers/messages.controller.ts — HTTP handlers for room chat history.
 * Real-time delivery happens over Socket.IO (realtime/socket.ts); these
 * endpoints cover initial history load and a REST fallback for sending.
 */

import type { Request, Response } from "express";
import z from "zod";
import { parseBody } from "../utils/validate.js";
import {
  assertRoomAccess,
  createMessage,
  getMessages,
  type SenderContext,
} from "../services/message.service.js";
import { getIO } from "../realtime/socket.js";

function senderContext(req: Request): SenderContext {
  if (req.customerId) return { customerId: req.customerId };
  return { shopkeeperId: req.shopkeeperId! };
}

async function checkAccess(
  roomId: string,
  ctx: SenderContext,
  res: Response,
): Promise<boolean> {
  try {
    await assertRoomAccess(roomId, ctx);
    return true;
  } catch (err: unknown) {
    const e = err as Error;
    if (e.message === "Room not found") {
      res.status(404).json({ message: "Room not found" });
    } else {
      res.status(403).json({ message: "You don't have access to this room" });
    }
    return false;
  }
}

// ─── GET /api/rooms/:roomId/messages ──────────────────────────────────────────
// Query params: page (0-based, default 0), limit (default 30, max 100)
// Auth: requireAnyAuth

export async function getRoomMessages(
  req: Request,
  res: Response,
): Promise<void> {
  const { roomId } = req.params as { roomId: string };
  const ctx = senderContext(req);

  const page = Math.max(
    0,
    parseInt((req.query.page as string) ?? "0", 10) || 0,
  );
  const limit = Math.min(
    100,
    Math.max(1, parseInt((req.query.limit as string) ?? "30", 10) || 30),
  );

  if (!(await checkAccess(roomId, ctx, res))) return;

  const result = await getMessages(roomId, { page, limit });
  res.json(result);
}

const sendMessageSchema = z.object({
  text: z.string().trim().min(1).max(2000),
});

// ─── POST /api/rooms/:roomId/messages ─────────────────────────────────────────
// Body: { text }
// Auth: requireAnyAuth
// REST fallback alongside the primary Socket.IO "message:send" path — still
// broadcasts to the room's live listeners so it doesn't fall out of sync.

export async function postRoomMessage(
  req: Request,
  res: Response,
): Promise<void> {
  const { roomId } = req.params as { roomId: string };
  const ctx = senderContext(req);

  const parsed = parseBody(req, sendMessageSchema);
  if (!parsed.ok) {
    res.status(400).json({
      message: "Validation error",
      issues: parsed.error.issues.map((i) => ({
        path: i.path,
        message: i.message,
      })),
    });
    return;
  }

  if (!(await checkAccess(roomId, ctx, res))) return;

  const dto = await createMessage(roomId, parsed.data.text, ctx);
  getIO().to(roomId).emit("message:new", dto);
  res.status(201).json({ data: dto, message: "Message sent" });
}
