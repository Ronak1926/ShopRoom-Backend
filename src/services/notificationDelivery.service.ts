/**
 * services/notificationDelivery.service.ts — Customer-facing read of a sent
 * push's design, resolved from the small sendId carried in the FCM payload.
 */

import { prisma } from "../database/prisma.js";
import { NotificationError } from "../utils/notificationError.js";

export async function getSendDesign(customerId: string, sendId: string) {
  const send = await prisma.notificationSend.findUnique({
    where: { id: sendId },
    select: {
      roomId: true,
      message: true,
      designVersion: { select: { designJson: true } },
      room: { select: { shop: { select: { shopName: true } } } },
    },
  });
  if (!send) throw NotificationError.notFound("Notification not found");

  // The customer must be someone this push was actually addressed to: a member
  // of the room, or a recipient row for this send (nearby non-members get
  // pushes too). Anything else 404s so a sendId can't be probed across shops.
  const [membership, recipient] = await Promise.all([
    prisma.membership.findFirst({
      where: { roomId: send.roomId, customerId },
      select: { id: true },
    }),
    prisma.notificationSendRecipient.findFirst({
      where: { sendId, customerId },
      select: { id: true },
    }),
  ]);
  if (!membership && !recipient) throw NotificationError.notFound("Notification not found");

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { fullName: true },
  });

  return {
    designJson: send.designVersion.designJson,
    message: send.message,
    roomId: send.roomId,
    context: {
      shop: { name: send.room.shop.shopName },
      customer: { name: customer?.fullName ?? "there" },
    },
  };
}

export const FEED_DAYS = 30;
export const FEED_LIMIT = 20;

export interface FeedItem {
  sendId: string;
  roomId: string;
  shopName: string;
  message: string | null;
  sentAt: string;
  /** True once any of the customer's devices opened it. */
  read: boolean;
  /** Presented back to /receipts when the notification is replayed, so opens are counted like a tap. */
  receiptToken: string;
}

/**
 * The customer's recent notifications for the bell: pushes that were actually
 * addressed to them (one row per send even if they have several devices),
 * newest first.
 */
export async function getFeed(customerId: string, now = new Date()): Promise<{ items: FeedItem[]; unread: number }> {
  const since = new Date(now.getTime() - FEED_DAYS * 86_400_000);
  // Several devices mean several rows per send; fetch a bounded multiple and fold them.
  const rows = await prisma.notificationSendRecipient.findMany({
    where: { customerId, status: "SENT", send: { status: "SENT", createdAt: { gte: since } } },
    orderBy: { send: { createdAt: "desc" } },
    take: FEED_LIMIT * 5,
    select: {
      sendId: true,
      receiptToken: true,
      openedAt: true,
      send: { select: { roomId: true, message: true, createdAt: true, room: { select: { shop: { select: { shopName: true } } } } } },
    },
  });

  const bySend = new Map<string, FeedItem>();
  for (const row of rows) {
    const existing = bySend.get(row.sendId);
    if (existing) {
      if (row.openedAt) existing.read = true;
      continue;
    }
    if (bySend.size >= FEED_LIMIT) continue;
    bySend.set(row.sendId, {
      sendId: row.sendId,
      roomId: row.send.roomId,
      shopName: row.send.room.shop.shopName,
      message: row.send.message,
      sentAt: row.send.createdAt.toISOString(),
      read: row.openedAt !== null,
      receiptToken: row.receiptToken,
    });
  }
  const items = [...bySend.values()];
  return { items, unread: items.filter((item) => !item.read).length };
}
