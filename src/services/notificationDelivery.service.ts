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
