/**
 * services/message.service.ts — Chat message business logic.
 *
 * A message is sent by either a customer member or the shop's own owner
 * (shopkeeper) — there is no shared identity table between the two, so
 * every function here takes an explicit sender context of one shape or
 * the other and resolves display info accordingly.
 */

import { prisma } from "../database/prisma.js";
import type { MessageSenderType } from "../generated/client.js";

export type SenderContext =
  | { customerId: string; shopkeeperId?: undefined }
  | { shopkeeperId: string; customerId?: undefined };

export interface MessageDTO {
  id: string;
  roomId: string;
  senderType: MessageSenderType;
  text: string;
  createdAt: string;
  sender: {
    id: string;
    name: string;
    shopName?: string;
  };
}

/**
 * Verifies the given sender context may access `roomId` — a customer must
 * have a Membership row, a shopkeeper must own the room's shop.
 *
 * Throws "Room not found" or "Access denied". Returns the room's shopId on
 * success (callers that only need the access check can ignore the result).
 */
export async function assertRoomAccess(
  roomId: string,
  ctx: SenderContext,
): Promise<{ shopId: string }> {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { shop: { select: { id: true, ownerId: true } } },
  });
  if (!room) throw new Error("Room not found");

  if (ctx.customerId) {
    const membership = await prisma.membership.findUnique({
      where: { roomId_customerId: { roomId, customerId: ctx.customerId } },
    });
    if (!membership) throw new Error("Access denied");
  } else if (room.shop.ownerId !== ctx.shopkeeperId) {
    throw new Error("Access denied");
  }

  return { shopId: room.shop.id };
}

function toDTO(row: {
  id: string;
  roomId: string;
  senderType: MessageSenderType;
  text: string;
  createdAt: Date;
  customer: { id: string; fullName: string } | null;
  shopkeeper: { id: string; shopName: string; ownerName: string | null } | null;
}): MessageDTO {
  const sender =
    row.senderType === "CUSTOMER"
      ? { id: row.customer!.id, name: row.customer!.fullName }
      : {
          id: row.shopkeeper!.id,
          name: row.shopkeeper!.ownerName ?? "Shop Owner",
          shopName: row.shopkeeper!.shopName,
        };

  return {
    id: row.id,
    roomId: row.roomId,
    senderType: row.senderType,
    text: row.text,
    createdAt: row.createdAt.toISOString(),
    sender,
  };
}

const MESSAGE_SELECT = {
  id: true,
  roomId: true,
  senderType: true,
  text: true,
  createdAt: true,
  customer: { select: { id: true, fullName: true } },
  shopkeeper: { select: { id: true, shopName: true, ownerName: true } },
} as const;

/**
 * Persists a new message and returns it already shaped for the client —
 * both the Socket.IO broadcast and the REST POST endpoint use this directly.
 */
export async function createMessage(
  roomId: string,
  text: string,
  ctx: SenderContext,
): Promise<MessageDTO> {
  const row = await prisma.message.create({
    data: {
      roomId,
      text,
      senderType: ctx.customerId ? "CUSTOMER" : "SHOPKEEPER",
      customerId: ctx.customerId ?? null,
      shopkeeperId: ctx.shopkeeperId ?? null,
    },
    select: MESSAGE_SELECT,
  });

  return toDTO(row);
}

/**
 * Paginated message history, oldest-first (reversed after the
 * newest-first DB query so pagination stays stable as new messages arrive).
 * Mirrors the skip/take pagination style used by getShopMembers.
 */
export async function getMessages(
  roomId: string,
  { page, limit }: { page: number; limit: number },
): Promise<{
  messages: MessageDTO[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> {
  const [rows, total] = await Promise.all([
    prisma.message.findMany({
      where: { roomId },
      orderBy: { createdAt: "desc" },
      skip: page * limit,
      take: limit,
      select: MESSAGE_SELECT,
    }),
    prisma.message.count({ where: { roomId } }),
  ]);

  return {
    messages: rows.reverse().map(toDTO),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}
