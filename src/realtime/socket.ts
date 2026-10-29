/**
 * realtime/socket.ts — Socket.IO server for live room chat.
 *
 * Auth mirrors the existing HTTP middleware exactly (customerAuth.ts /
 * shopkeeperAuth.ts): a bearer token is verified with the same
 * verifyCustomerToken/verifyShopkeeperToken functions from utils/jwt.ts,
 * just read from the handshake instead of a header.
 *
 * Presence and typing state are kept in-memory (single-process) — fine for
 * this stage; would need a shared store (e.g. Redis) behind multiple
 * server instances.
 */

import type { Server as HTTPServer } from "http";
import { Server as SocketIOServer, type Socket } from "socket.io";
import { allowedOrigins } from "../config/env.js";
import { verifyCustomerToken, verifyShopkeeperToken } from "../utils/jwt.js";
import { prisma } from "../database/prisma.js";
import { isSessionActive } from "../services/session.service.js";
import {
  assertRoomAccess,
  createMessage,
  editMessage,
  deleteMessage,
  reactToMessage,
  markRoomRead,
  getUnseenOwnEligibleMessages,
  clearRoomForViewer,
  viewerKeyOf,
  type MessageDTO,
  type SenderContext,
} from "../services/message.service.js";

// ── Event contracts ────────────────────────────────────────────────────────────

interface ServerToClientEvents {
  "message:new": (message: MessageDTO) => void;
  "message:updated": (message: MessageDTO) => void;
  "message:deleted": (payload: { roomId: string; messageId: string }) => void;
  "message:removed": (payload: { roomId: string; messageId: string }) => void;
  "message:reacted": (payload: {
    roomId: string;
    messageId: string;
    reactions: MessageDTO["reactions"];
  }) => void;
  "message:seen": (payload: { roomId: string; messageIds: string[] }) => void;
  "chat:cleared": (payload: { roomId: string; clearedAt: string }) => void;
  "presence:update": (payload: {
    roomId: string;
    onlineCustomerIds: string[];
  }) => void;
  "typing:update": (payload: {
    roomId: string;
    userId: string;
    name: string;
    isTyping: boolean;
  }) => void;
  "member:joined": (payload: {
    roomId: string;
    customerId: string;
    customerName: string;
  }) => void;
  "member:left": (payload: { roomId: string; customerId: string }) => void;
  error: (payload: { message: string }) => void;
}

interface ClientToServerEvents {
  "room:join": (payload: { roomId: string }) => void;
  "room:leave": (payload: { roomId: string }) => void;
  "room:read": (payload: { roomId: string; at: string }) => void;
  "message:send": (payload: {
    roomId: string;
    text: string;
    replyToId?: string;
  }) => void;
  "message:edit": (payload: { roomId: string; messageId: string; text: string }) => void;
  "message:delete": (payload: {
    roomId: string;
    messageId: string;
    scope: "everyone" | "me";
  }) => void;
  "message:react": (payload: { roomId: string; messageId: string; emoji: string }) => void;
  "chat:clear": (payload: { roomId: string }) => void;
  "typing:start": (payload: { roomId: string }) => void;
  "typing:stop": (payload: { roomId: string }) => void;
}

type InterServerEvents = Record<string, never>;

interface SocketData {
  customerId?: string;
  shopkeeperId?: string;
  name: string;
  typingRooms: Set<string>;
}

type AppServer = SocketIOServer<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;
type AppSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

// ── Presence + rate-limit state ────────────────────────────────────────────────

const presenceByRoom = new Map<string, Set<string>>();
const sendTimestampsBySocket = new Map<string, number[]>();
const RATE_LIMIT_MAX_MESSAGES = 10;
const RATE_LIMIT_WINDOW_MS = 10_000;

function isRateLimited(socketId: string): boolean {
  const now = Date.now();
  const recent = (sendTimestampsBySocket.get(socketId) ?? []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS,
  );
  recent.push(now);
  sendTimestampsBySocket.set(socketId, recent);
  return recent.length > RATE_LIMIT_MAX_MESSAGES;
}

function emitPresence(io: AppServer, roomId: string) {
  const ids = Array.from(presenceByRoom.get(roomId) ?? []);
  io.to(roomId).emit("presence:update", { roomId, onlineCustomerIds: ids });
}

/** Room and message ids are short opaque strings; anything else is a malformed event. */
function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64;
}

function senderIdOf(data: SocketData): string {
  return (data.customerId ?? data.shopkeeperId)!;
}

/** The personal room every socket joins on connection, keyed by the same
 * viewerKey convention used throughout message.service.ts — lets the server
 * push events to "this participant, wherever they're connected" (handles
 * multiple tabs/reconnects for free) without broadcasting to the whole room. */
function personalRoom(viewerKey: string): string {
  return `user:${viewerKey}`;
}

// ── Server ─────────────────────────────────────────────────────────────────────

let ioInstance: AppServer | null = null;

export function createSocketServer(httpServer: HTTPServer): AppServer {
  const io: AppServer = new SocketIOServer(httpServer, {
    cors: {
      origin(origin, callback) {
        const allowed = allowedOrigins();
        callback(null, !origin || allowed === null || allowed.includes(origin));
      },
    },
    // Snappier stale-connection detection than the 25s/20s defaults, so a
    // closed tab clears its "online" presence in seconds, not tens of seconds.
    pingInterval: 10_000,
    pingTimeout: 5_000,
  });

  io.use(async (socket, next) => {
    const { token, role } = socket.handshake.auth as {
      token?: string;
      role?: "customer" | "shopkeeper";
    };
    if (!token || !role) {
      next(new Error("Missing auth"));
      return;
    }

    try {
      if (role === "customer") {
        const payload = verifyCustomerToken(token);
        if (!(await isSessionActive("customer", payload.sub, payload.tv))) {
          throw new Error("Session revoked");
        }
        const customer = await prisma.customer.findUnique({
          where: { id: payload.sub },
          select: { fullName: true },
        });
        if (!customer) throw new Error("Customer not found");
        socket.data.customerId = payload.sub;
        socket.data.name = customer.fullName;
        socket.data.typingRooms = new Set();
      } else if (role === "shopkeeper") {
        const payload = verifyShopkeeperToken(token);
        if (!(await isSessionActive("shopkeeper", payload.sub, payload.tv))) {
          throw new Error("Session revoked");
        }
        const shopkeeper = await prisma.shopkeeper.findUnique({
          where: { id: payload.sub },
          select: { ownerName: true },
        });
        if (!shopkeeper) throw new Error("Shopkeeper not found");
        socket.data.shopkeeperId = payload.sub;
        socket.data.name = shopkeeper.ownerName ?? "Shop Owner";
        socket.data.typingRooms = new Set();
      } else {
        throw new Error("Invalid role");
      }
      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket: AppSocket) => {
    const ctx: SenderContext = socket.data.customerId
      ? { customerId: socket.data.customerId }
      : { shopkeeperId: socket.data.shopkeeperId! };
    const myViewerKey = viewerKeyOf(ctx);

    socket.join(personalRoom(myViewerKey));

    function stopTyping(roomId: string) {
      if (!socket.data.typingRooms.has(roomId)) return;
      socket.data.typingRooms.delete(roomId);
      socket.to(roomId).emit("typing:update", {
        roomId,
        userId: senderIdOf(socket.data),
        name: socket.data.name,
        isTyping: false,
      });
    }

    socket.on("room:join", async ({ roomId }) => {
      if (!isId(roomId)) return;
      try {
        await assertRoomAccess(roomId, ctx);
      } catch {
        socket.emit("error", { message: "Access denied" });
        return;
      }
      socket.join(roomId);
      if (socket.data.customerId) {
        if (!presenceByRoom.has(roomId)) presenceByRoom.set(roomId, new Set());
        presenceByRoom.get(roomId)!.add(socket.data.customerId);
        emitPresence(io, roomId);
      }

      // Catch this participant's own client up on any of their messages
      // that became ineligible for edit/delete while they were disconnected.
      try {
        const alreadySeenIds = await getUnseenOwnEligibleMessages(roomId, ctx);
        if (alreadySeenIds.length) {
          socket.emit("message:seen", { roomId, messageIds: alreadySeenIds });
        }
      } catch {
        // best-effort — not worth failing the join over
      }
    });

    socket.on("room:leave", ({ roomId }) => {
      if (!isId(roomId)) return;
      socket.leave(roomId);
      if (socket.data.customerId) {
        presenceByRoom.get(roomId)?.delete(socket.data.customerId);
        emitPresence(io, roomId);
      }
      stopTyping(roomId);
    });

    socket.on("message:send", async ({ roomId, text, replyToId }) => {
      if (!isId(roomId) || typeof text !== "string") return;
      if (replyToId !== undefined && !isId(replyToId)) return;
      const trimmed = text.trim();
      if (!trimmed || trimmed.length > 2000) {
        socket.emit("error", {
          message: "Message must be 1-2000 characters",
        });
        return;
      }
      if (isRateLimited(socket.id)) {
        socket.emit("error", {
          message: "You're sending messages too fast",
        });
        return;
      }
      try {
        await assertRoomAccess(roomId, ctx);
        const message = await createMessage(roomId, trimmed, ctx, replyToId);
        io.to(roomId).emit("message:new", message);
      } catch {
        socket.emit("error", { message: "Could not send message" });
      }
    });

    socket.on("message:edit", async ({ roomId, messageId, text }) => {
      if (!isId(roomId) || !isId(messageId) || typeof text !== "string") return;
      const trimmed = text.trim();
      if (!trimmed || trimmed.length > 2000) {
        socket.emit("error", { message: "Message must be 1-2000 characters" });
        return;
      }
      if (isRateLimited(socket.id)) {
        socket.emit("error", { message: "You're sending messages too fast" });
        return;
      }
      try {
        await assertRoomAccess(roomId, ctx);
        const updated = await editMessage(roomId, messageId, trimmed, ctx);
        io.to(roomId).emit("message:updated", updated);
      } catch (err) {
        socket.emit("error", {
          message: err instanceof Error ? err.message : "Could not edit message",
        });
      }
    });

    socket.on("message:delete", async ({ roomId, messageId, scope }) => {
      if (!isId(roomId) || !isId(messageId) || (scope !== "everyone" && scope !== "me")) return;
      if (isRateLimited(socket.id)) {
        socket.emit("error", { message: "You're sending messages too fast" });
        return;
      }
      try {
        await assertRoomAccess(roomId, ctx);
        await deleteMessage(roomId, messageId, scope, ctx);
        if (scope === "everyone") {
          io.to(roomId).emit("message:deleted", { roomId, messageId });
        } else {
          socket.emit("message:removed", { roomId, messageId });
        }
      } catch (err) {
        socket.emit("error", {
          message: err instanceof Error ? err.message : "Could not delete message",
        });
      }
    });

    socket.on("message:react", async ({ roomId, messageId, emoji }) => {
      if (!isId(roomId) || !isId(messageId) || typeof emoji !== "string" || !emoji) return;
      if (isRateLimited(socket.id)) {
        socket.emit("error", { message: "You're sending messages too fast" });
        return;
      }
      try {
        await assertRoomAccess(roomId, ctx);
        const reactions = await reactToMessage(roomId, messageId, emoji, ctx);
        io.to(roomId).emit("message:reacted", { roomId, messageId, reactions });
      } catch {
        socket.emit("error", { message: "Could not react to message" });
      }
    });

    socket.on("room:read", async ({ roomId, at }) => {
      if (!isId(roomId) || typeof at !== "string") return;
      const atDate = new Date(at);
      if (Number.isNaN(atDate.getTime())) return;
      try {
        await assertRoomAccess(roomId, ctx);
        const newlySeen = await markRoomRead(roomId, ctx, atDate);
        for (const { senderViewerKey, messageIds } of newlySeen) {
          io.to(personalRoom(senderViewerKey)).emit("message:seen", {
            roomId,
            messageIds,
          });
        }
      } catch {
        // best-effort — read receipts aren't worth surfacing an error toast
      }
    });

    socket.on("chat:clear", async ({ roomId }) => {
      if (!isId(roomId)) return;
      try {
        await assertRoomAccess(roomId, ctx);
        const clearedAt = await clearRoomForViewer(roomId, ctx);
        socket.emit("chat:cleared", { roomId, clearedAt: clearedAt.toISOString() });
      } catch {
        socket.emit("error", { message: "Could not clear chat" });
      }
    });

    socket.on("typing:start", ({ roomId }) => {
      // Only rooms this socket was admitted to (room:join checks membership);
      // otherwise anyone could spoof "X is typing" into a room they can't see.
      if (!isId(roomId) || !socket.rooms.has(roomId)) return;
      socket.data.typingRooms.add(roomId);
      socket.to(roomId).emit("typing:update", {
        roomId,
        userId: senderIdOf(socket.data),
        name: socket.data.name,
        isTyping: true,
      });
    });

    socket.on("typing:stop", ({ roomId }) => {
      if (!isId(roomId)) return;
      stopTyping(roomId);
    });

    socket.on("disconnect", () => {
      for (const roomId of socket.data.typingRooms) stopTyping(roomId);
      if (socket.data.customerId) {
        for (const [roomId, ids] of presenceByRoom) {
          if (ids.delete(socket.data.customerId)) emitPresence(io, roomId);
        }
      }
      sendTimestampsBySocket.delete(socket.id);
    });
  });

  ioInstance = io;
  return io;
}

/** Drops every live connection of one participant (account deleted or signed out everywhere). */
export function disconnectViewer(viewerKey: string): void {
  ioInstance?.in(personalRoom(viewerKey)).disconnectSockets(true);
}

/**
 * Takes a customer out of a room's live channel after they leave it or their
 * account is deleted — otherwise their open sockets would keep receiving the
 * room's messages — and tells the remaining participants.
 */
export function removeViewerFromRoom(customerId: string, roomId: string): void {
  if (!ioInstance) return;
  ioInstance.in(personalRoom(customerId)).socketsLeave(roomId);
  presenceByRoom.get(roomId)?.delete(customerId);
  emitPresence(ioInstance, roomId);
  ioInstance.to(roomId).emit("member:left", { roomId, customerId });
}

/** Empties a room's live channel (its shop was deleted). */
export function closeRoom(roomId: string): void {
  if (!ioInstance) return;
  ioInstance.in(roomId).socketsLeave(roomId);
  presenceByRoom.delete(roomId);
}

/** The Socket.IO singleton — used by the REST POST endpoint to broadcast
 * messages sent outside of a socket connection. */
export function getIO(): AppServer {
  if (!ioInstance) throw new Error("Socket.IO server not initialized");
  return ioInstance;
}
