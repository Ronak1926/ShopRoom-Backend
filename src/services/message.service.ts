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
import { encryptText, decryptText } from "../utils/crypto.js";

export type SenderContext =
  | { customerId: string; shopkeeperId?: undefined }
  | { shopkeeperId: string; customerId?: undefined };

export interface MessageDTO {
  id: string;
  roomId: string;
  senderType: MessageSenderType;
  text: string;
  createdAt: string;
  editedAt: string | null;
  deletedForEveryone: boolean;
  sender: {
    id: string;
    name: string;
    shopName?: string;
  };
  replyTo: {
    id: string;
    text: string;
    senderName: string;
    deletedForEveryone: boolean;
  } | null;
  reactions: {
    emoji: string;
    viewerId: string;
    viewerName: string;
  }[];
}

/** Edit / delete-for-everyone are only allowed within this window of send time. */
const EDIT_DELETE_WINDOW_MS = 60 * 60 * 1000;

/** One unambiguous identity per room participant — avoids the partial-null
 * unique-index pitfall of keying directly on two nullable FK columns. */
export function viewerKeyOf(ctx: SenderContext): string {
  return ctx.customerId ?? `SK:${ctx.shopkeeperId}`;
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
): Promise<{ shopId: string; shopLat: number | null; shopLng: number | null }> {
  // Single round trip: the membership existence check (customer path) rides
  // along with the room/shop lookup instead of a second sequential query.
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: {
      shop: {
        select: { id: true, ownerId: true, latitude: true, longitude: true },
      },
      memberships: ctx.customerId
        ? { where: { customerId: ctx.customerId }, select: { id: true }, take: 1 }
        : false,
    },
  });
  if (!room) throw new Error("Room not found");

  if (ctx.customerId) {
    if (!room.memberships?.length) throw new Error("Access denied");
  } else if (room.shop.ownerId !== ctx.shopkeeperId) {
    throw new Error("Access denied");
  }

  return {
    shopId: room.shop.id,
    shopLat: room.shop.latitude,
    shopLng: room.shop.longitude,
  };
}

interface ReplyToRow {
  id: string;
  text: string;
  deletedForEveryone: boolean;
  senderType: MessageSenderType;
  customer: { fullName: string } | null;
  shopkeeper: { shopName: string; ownerName: string | null } | null;
}

interface ReactionRow {
  emoji: string;
  customerId: string | null;
  shopkeeperId: string | null;
  customer: { fullName: string } | null;
  shopkeeper: { shopName: string; ownerName: string | null } | null;
}

function replyPreviewOf(row: ReplyToRow | null): MessageDTO["replyTo"] {
  if (!row) return null;
  const senderName =
    row.senderType === "CUSTOMER"
      ? row.customer!.fullName
      : (row.shopkeeper!.ownerName ?? "Shop Owner");

  return {
    id: row.id,
    text: row.deletedForEveryone ? "" : decryptText(row.text),
    senderName,
    deletedForEveryone: row.deletedForEveryone,
  };
}

function reactionsOf(rows: ReactionRow[]): MessageDTO["reactions"] {
  return rows.map((r) => ({
    emoji: r.emoji,
    viewerId: r.customerId ?? r.shopkeeperId!,
    viewerName: r.customerId
      ? r.customer!.fullName
      : (r.shopkeeper!.ownerName ?? "Shop Owner"),
  }));
}

function toDTO(row: {
  id: string;
  roomId: string;
  senderType: MessageSenderType;
  text: string;
  createdAt: Date;
  editedAt: Date | null;
  deletedForEveryone: boolean;
  customer: { id: string; fullName: string } | null;
  shopkeeper: { id: string; shopName: string; ownerName: string | null } | null;
  replyTo: ReplyToRow | null;
  reactions: ReactionRow[];
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
    text: row.deletedForEveryone ? "" : decryptText(row.text),
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt ? row.editedAt.toISOString() : null,
    deletedForEveryone: row.deletedForEveryone,
    sender,
    replyTo: replyPreviewOf(row.replyTo),
    reactions: reactionsOf(row.reactions),
  };
}

const REPLY_TO_SELECT = {
  id: true,
  text: true,
  deletedForEveryone: true,
  senderType: true,
  customer: { select: { fullName: true } },
  shopkeeper: { select: { shopName: true, ownerName: true } },
} as const;

const REACTION_SELECT = {
  emoji: true,
  customerId: true,
  shopkeeperId: true,
  customer: { select: { fullName: true } },
  shopkeeper: { select: { shopName: true, ownerName: true } },
} as const;

const MESSAGE_SELECT = {
  id: true,
  roomId: true,
  senderType: true,
  text: true,
  createdAt: true,
  editedAt: true,
  deletedForEveryone: true,
  customer: { select: { id: true, fullName: true } },
  shopkeeper: { select: { id: true, shopName: true, ownerName: true } },
  replyTo: { select: REPLY_TO_SELECT },
  reactions: { select: REACTION_SELECT },
} as const;

/**
 * Persists a new message and returns it already shaped for the client —
 * both the Socket.IO broadcast and the REST POST endpoint use this directly.
 * `replyToId`, if given, is only honored when it points to a message in the
 * same room — otherwise the reply link is silently dropped.
 */
export async function createMessage(
  roomId: string,
  text: string,
  ctx: SenderContext,
  replyToId?: string,
): Promise<MessageDTO> {
  let validReplyToId: string | null = null;
  if (replyToId) {
    const target = await prisma.message.findUnique({
      where: { id: replyToId },
      select: { roomId: true },
    });
    if (target && target.roomId === roomId) validReplyToId = replyToId;
  }

  const row = await prisma.message.create({
    data: {
      roomId,
      text: encryptText(text),
      senderType: ctx.customerId ? "CUSTOMER" : "SHOPKEEPER",
      customerId: ctx.customerId ?? null,
      shopkeeperId: ctx.shopkeeperId ?? null,
      replyToId: validReplyToId,
    },
    select: MESSAGE_SELECT,
  });

  return toDTO(row);
}

/**
 * Paginated message history, oldest-first (reversed after the
 * newest-first DB query so pagination stays stable as new messages arrive).
 * Excludes messages the viewer deleted-for-me and anything before their own
 * Clear Chat boundary.
 */
export async function getMessages(
  roomId: string,
  { page, limit }: { page: number; limit: number },
  ctx: SenderContext,
): Promise<{
  messages: MessageDTO[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> {
  const viewerKey = viewerKeyOf(ctx);
  const viewerState = await prisma.roomViewerState.findUnique({
    where: { roomId_viewerKey: { roomId, viewerKey } },
    select: { clearedAt: true },
  });

  const where = {
    roomId,
    ...(viewerState?.clearedAt ? { createdAt: { gt: viewerState.clearedAt } } : {}),
    hiddenFor: { none: { viewerKey } },
  };

  const [rows, total] = await Promise.all([
    prisma.message.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: page * limit,
      take: limit,
      select: MESSAGE_SELECT,
    }),
    prisma.message.count({ where }),
  ]);

  return {
    messages: rows.reverse().map(toDTO),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * True only if the message is still within the edit/delete window AND no
 * other room participant has read up to (or past) it yet. Re-checked
 * server-side on every edit/delete attempt regardless of what the client's
 * own (live-updated) UI state believes.
 */
async function canModifyMessage(
  message: { roomId: string; createdAt: Date },
  senderViewerKey: string,
): Promise<boolean> {
  if (Date.now() - message.createdAt.getTime() >= EDIT_DELETE_WINDOW_MS) return false;

  const seenByOther = await prisma.roomViewerState.findFirst({
    where: {
      roomId: message.roomId,
      viewerKey: { not: senderViewerKey },
      lastReadAt: { gte: message.createdAt },
    },
    select: { id: true },
  });
  return !seenByOther;
}

export async function editMessage(
  messageId: string,
  text: string,
  ctx: SenderContext,
): Promise<MessageDTO> {
  const row = await prisma.message.findUnique({
    where: { id: messageId },
    select: {
      roomId: true,
      createdAt: true,
      customerId: true,
      shopkeeperId: true,
      deletedForEveryone: true,
    },
  });
  if (!row) throw new Error("Message not found");

  const senderViewerKey = row.customerId ?? `SK:${row.shopkeeperId}`;
  if (senderViewerKey !== viewerKeyOf(ctx)) throw new Error("Not your message");
  if (row.deletedForEveryone) throw new Error("Message was deleted");
  if (!(await canModifyMessage(row, senderViewerKey))) {
    throw new Error("This message can no longer be edited");
  }

  const updated = await prisma.message.update({
    where: { id: messageId },
    data: { text: encryptText(text), editedAt: new Date() },
    select: MESSAGE_SELECT,
  });
  return toDTO(updated);
}

/**
 * `"me"` hides the message from the caller's own view only (idempotent, no
 * eligibility check, no broadcast — caller notifies only the acting socket).
 * `"everyone"` soft-deletes the shared row for the whole room, gated by the
 * same rules as editing, and clears any reactions on it.
 */
export async function deleteMessage(
  messageId: string,
  scope: "everyone" | "me",
  ctx: SenderContext,
): Promise<void> {
  const viewerKey = viewerKeyOf(ctx);

  if (scope === "me") {
    await prisma.messageHiddenFor.upsert({
      where: { messageId_viewerKey: { messageId, viewerKey } },
      create: { messageId, viewerKey },
      update: {},
    });
    return;
  }

  const row = await prisma.message.findUnique({
    where: { id: messageId },
    select: {
      roomId: true,
      createdAt: true,
      customerId: true,
      shopkeeperId: true,
      deletedForEveryone: true,
    },
  });
  if (!row) throw new Error("Message not found");
  if (row.deletedForEveryone) return;

  const senderViewerKey = row.customerId ?? `SK:${row.shopkeeperId}`;
  if (senderViewerKey !== viewerKey) throw new Error("Not your message");
  if (!(await canModifyMessage(row, senderViewerKey))) {
    throw new Error("This message can no longer be deleted");
  }

  await prisma.$transaction([
    prisma.messageReaction.deleteMany({ where: { messageId } }),
    prisma.message.update({
      where: { id: messageId },
      data: { deletedForEveryone: true, text: "" },
    }),
  ]);
}

/** Toggle a reaction: same emoji again removes it, a different emoji replaces
 * it. Returns the message's refreshed flat reaction list. */
export async function reactToMessage(
  messageId: string,
  emoji: string,
  ctx: SenderContext,
): Promise<MessageDTO["reactions"]> {
  const viewerKey = viewerKeyOf(ctx);
  const existing = await prisma.messageReaction.findUnique({
    where: { messageId_viewerKey: { messageId, viewerKey } },
  });

  if (existing && existing.emoji === emoji) {
    await prisma.messageReaction.delete({ where: { id: existing.id } });
  } else {
    await prisma.messageReaction.upsert({
      where: { messageId_viewerKey: { messageId, viewerKey } },
      create: {
        messageId,
        viewerKey,
        customerId: ctx.customerId ?? null,
        shopkeeperId: ctx.shopkeeperId ?? null,
        emoji,
      },
      update: { emoji },
    });
  }

  const rows = await prisma.messageReaction.findMany({
    where: { messageId },
    select: REACTION_SELECT,
  });
  return reactionsOf(rows);
}

/**
 * Advances the caller's read cursor to `at` and reports which of *other*
 * participants' messages this newly covers, grouped by sender — the socket
 * layer uses this to push a live "message:seen" only to those senders.
 */
export async function markRoomRead(
  roomId: string,
  ctx: SenderContext,
  at: Date,
): Promise<{ senderViewerKey: string; messageIds: string[] }[]> {
  const viewerKey = viewerKeyOf(ctx);
  const previous = await prisma.roomViewerState.findUnique({
    where: { roomId_viewerKey: { roomId, viewerKey } },
    select: { lastReadAt: true },
  });
  const previousAt = previous?.lastReadAt ?? new Date(0);

  await prisma.roomViewerState.upsert({
    where: { roomId_viewerKey: { roomId, viewerKey } },
    create: {
      roomId,
      viewerKey,
      customerId: ctx.customerId ?? null,
      shopkeeperId: ctx.shopkeeperId ?? null,
      lastReadAt: at,
    },
    update: { lastReadAt: at },
  });

  if (at <= previousAt) return [];

  // Expressed as a positive OR, not a NOT on a nullable column: "customerId
  // != ctx.customerId" would silently exclude every shopkeeper-sent message
  // too, since SQL's three-valued logic treats "NULL != 'x'" as UNKNOWN
  // (not TRUE) rather than the TRUE we'd want here.
  const newlyRead = await prisma.message.findMany({
    where: {
      roomId,
      createdAt: { gt: previousAt, lte: at },
      deletedForEveryone: false,
      OR: ctx.customerId
        ? [{ senderType: "SHOPKEEPER" }, { senderType: "CUSTOMER", customerId: { not: ctx.customerId } }]
        : [{ senderType: "CUSTOMER" }, { senderType: "SHOPKEEPER", shopkeeperId: { not: ctx.shopkeeperId } }],
    },
    select: { id: true, customerId: true, shopkeeperId: true },
  });

  const bySender = new Map<string, string[]>();
  for (const m of newlyRead) {
    const senderViewerKey = m.customerId ?? `SK:${m.shopkeeperId}`;
    const ids = bySender.get(senderViewerKey) ?? [];
    ids.push(m.id);
    bySender.set(senderViewerKey, ids);
  }
  return Array.from(bySender.entries()).map(([senderViewerKey, messageIds]) => ({
    senderViewerKey,
    messageIds,
  }));
}

/**
 * Used on room:join — this participant's own messages from the last hour
 * that some *other* participant already read before this connection was
 * established, so the live-hide state is correct immediately on (re)connect.
 */
export async function getUnseenOwnEligibleMessages(
  roomId: string,
  ctx: SenderContext,
): Promise<string[]> {
  const viewerKey = viewerKeyOf(ctx);
  const since = new Date(Date.now() - EDIT_DELETE_WINDOW_MS);

  const ownMessages = await prisma.message.findMany({
    where: {
      roomId,
      createdAt: { gte: since },
      deletedForEveryone: false,
      ...(ctx.customerId ? { customerId: ctx.customerId } : { shopkeeperId: ctx.shopkeeperId }),
    },
    select: { id: true, createdAt: true },
  });
  if (!ownMessages.length) return [];

  const otherCursors = await prisma.roomViewerState.findMany({
    where: { roomId, viewerKey: { not: viewerKey }, lastReadAt: { not: null } },
    select: { lastReadAt: true },
  });
  if (!otherCursors.length) return [];

  const maxOtherRead = otherCursors.reduce(
    (max, c) => (c.lastReadAt! > max ? c.lastReadAt! : max),
    new Date(0),
  );

  return ownMessages.filter((m) => m.createdAt <= maxOtherRead).map((m) => m.id);
}

/** Clear Chat — moves the caller's own visibility boundary to now; doesn't
 * touch the shared room history or any other participant's view. */
export async function clearRoomForViewer(roomId: string, ctx: SenderContext): Promise<Date> {
  const viewerKey = viewerKeyOf(ctx);
  const clearedAt = new Date();
  await prisma.roomViewerState.upsert({
    where: { roomId_viewerKey: { roomId, viewerKey } },
    create: {
      roomId,
      viewerKey,
      customerId: ctx.customerId ?? null,
      shopkeeperId: ctx.shopkeeperId ?? null,
      clearedAt,
    },
    update: { clearedAt },
  });
  return clearedAt;
}
