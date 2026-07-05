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
import { verifyCustomerToken, verifyShopkeeperToken } from "../utils/jwt.js";
import { prisma } from "../database/prisma.js";
import {
  assertRoomAccess,
  createMessage,
  type MessageDTO,
  type SenderContext,
} from "../services/message.service.js";

// ── Event contracts ────────────────────────────────────────────────────────────

interface ServerToClientEvents {
  "message:new": (message: MessageDTO) => void;
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
  error: (payload: { message: string }) => void;
}

interface ClientToServerEvents {
  "room:join": (payload: { roomId: string }) => void;
  "room:leave": (payload: { roomId: string }) => void;
  "message:send": (payload: { roomId: string; text: string }) => void;
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

function senderIdOf(data: SocketData): string {
  return (data.customerId ?? data.shopkeeperId)!;
}

// ── Server ─────────────────────────────────────────────────────────────────────

let ioInstance: AppServer | null = null;

export function createSocketServer(httpServer: HTTPServer): AppServer {
  const io: AppServer = new SocketIOServer(httpServer, {
    cors: { origin: true, credentials: true },
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
      if (!roomId) return;
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
    });

    socket.on("room:leave", ({ roomId }) => {
      if (!roomId) return;
      socket.leave(roomId);
      if (socket.data.customerId) {
        presenceByRoom.get(roomId)?.delete(socket.data.customerId);
        emitPresence(io, roomId);
      }
      stopTyping(roomId);
    });

    socket.on("message:send", async ({ roomId, text }) => {
      if (!roomId || typeof text !== "string") return;
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
        const message = await createMessage(roomId, trimmed, ctx);
        io.to(roomId).emit("message:new", message);
      } catch {
        socket.emit("error", { message: "Could not send message" });
      }
    });

    socket.on("typing:start", ({ roomId }) => {
      if (!roomId) return;
      socket.data.typingRooms.add(roomId);
      socket.to(roomId).emit("typing:update", {
        roomId,
        userId: senderIdOf(socket.data),
        name: socket.data.name,
        isTyping: true,
      });
    });

    socket.on("typing:stop", ({ roomId }) => {
      if (!roomId) return;
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

/** The Socket.IO singleton — used by the REST POST endpoint to broadcast
 * messages sent outside of a socket connection. */
export function getIO(): AppServer {
  if (!ioInstance) throw new Error("Socket.IO server not initialized");
  return ioInstance;
}
