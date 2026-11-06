/**
 * services/shopkeeperAccount.service.ts — Erasing a shopkeeper account.
 */

import { prisma } from "../database/prisma.js";
import { deleteImages, publicIdFromUrl } from "../lib/cloudinary.js";
import { closeRoom } from "../realtime/socket.js";
import { forgetSession } from "./session.service.js";
import { logger } from "../lib/logger.js";

/**
 * Permanently deletes the shopkeeper together with their shop, room (members'
 * memberships and the whole chat history), designs, assets, schedules and send
 * history. Customers' own accounts are untouched.
 *
 * Sends and schedules are removed first: a send pins an immutable design
 * version with ON DELETE RESTRICT, so the designs can't cascade away while any
 * send still points at them.
 */
export async function deleteShopkeeperAccount(shopkeeperId: string): Promise<void> {
  const [shop, assets] = await Promise.all([
    prisma.shop.findUnique({
      where: { ownerId: shopkeeperId },
      select: { logoUrl: true, room: { select: { id: true, coverUrl: true } } },
    }),
    prisma.notificationAsset.findMany({
      where: { shopkeeperId },
      select: { cloudinaryPublicId: true },
    }),
  ]);

  await prisma.$transaction([
    prisma.notificationSchedule.deleteMany({ where: { shopkeeperId } }),
    prisma.passwordResetToken.deleteMany({ where: { role: "SHOPKEEPER", accountId: shopkeeperId } }),
    prisma.securityEvent.deleteMany({ where: { actorRole: "SHOPKEEPER", actorId: shopkeeperId } }),
    prisma.notificationSend.deleteMany({ where: { shopkeeperId } }),
    prisma.shopkeeper.delete({ where: { id: shopkeeperId } }),
  ]);

  forgetSession("shopkeeper", shopkeeperId);
  if (shop?.room) closeRoom(shop.room.id);

  // The rows are gone; image cleanup is best effort and must not fail the request.
  const publicIds = [
    ...assets.map((a) => a.cloudinaryPublicId),
    ...[shop?.logoUrl, shop?.room?.coverUrl]
      .map((url) => (url ? publicIdFromUrl(url) : null))
      .filter((id): id is string => id !== null),
  ];
  await deleteImages(publicIds).catch((err) => {
    logger.error("Image cleanup after account deletion failed", err);
  });
}
