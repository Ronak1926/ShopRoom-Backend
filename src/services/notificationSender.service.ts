/**
 * services/notificationSender.service.ts — The shop-side facts every send or
 * schedule needs: which room it goes to, where the shop is, and what plan
 * governs its limits.
 */

import { prisma } from "../database/prisma.js";
import { NotificationError } from "../utils/notificationError.js";
import { isPlanActive } from "./billing.service.js";

export interface SenderContext {
  roomId: string;
  shopName: string;
  planType: string;
  /** False once the subscription has run out: sends and schedules are refused until it is renewed. */
  planActive: boolean;
  hasCoordinates: boolean;
}

export const PLAN_EXPIRED_MESSAGE = "Your plan has expired. Renew it in Billing to send notifications again.";

export async function loadSenderContext(shopkeeperId: string): Promise<SenderContext> {
  const shop = await prisma.shop.findUnique({
    where: { ownerId: shopkeeperId },
    select: {
      shopName: true,
      latitude: true,
      longitude: true,
      owner: { select: { planType: true, planExpiresAt: true } },
      room: { select: { id: true } },
    },
  });
  if (!shop?.room) throw NotificationError.badRequest("No room found for this shop");

  return {
    roomId: shop.room.id,
    shopName: shop.shopName,
    planType: shop.owner.planType,
    planActive: isPlanActive(shop.owner.planExpiresAt),
    hasCoordinates: shop.latitude !== null && shop.longitude !== null,
  };
}

export function assertPlanActive(sender: SenderContext): void {
  if (!sender.planActive) throw NotificationError.paymentRequired(PLAN_EXPIRED_MESSAGE);
}

export function assertShopHasLocation(sender: SenderContext): void {
  if (!sender.hasCoordinates) {
    throw NotificationError.badRequest(
      "Add your shop location in Profile to target customers by distance.",
    );
  }
}
