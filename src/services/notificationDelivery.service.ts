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

  // A customer must be a member of the room this push belongs to — prevents
  // cross-shop reads by guessing a sendId.
  const membership = await prisma.membership.findFirst({
    where: { roomId: send.roomId, customerId },
    select: { id: true },
  });
  if (!membership) throw NotificationError.notFound("Notification not found");

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
