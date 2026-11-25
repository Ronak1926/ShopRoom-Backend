/**
 * services/registration.service.ts — Turning a paid-for draft into a real account: the
 * shopkeeper, their shop and its room, in one transaction. Called by payment settlement
 * while it holds the order and draft rows locked, so it never runs twice for one payment.
 */

import type { Prisma, PaymentOrder, ShopkeeperDraft } from "../generated/client.js";
import { prisma } from "../database/prisma.js";
import { generateUniqueInviteCode, buildInviteLink } from "../utils/inviteCode.js";
import type { RegistrationResult } from "../types/index.js";
import { isPlanId, planEndsAt } from "./plans.js";

/** Free-text fields of a draft are stored as JSON; a missing one becomes an empty string. */
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const optionalText = (value: unknown): string | null => (typeof value === "string" ? value : null);
const optionalNumber = (value: unknown): number | null => (typeof value === "number" ? value : null);

/** Creates the shopkeeper, shop and room for a draft, on the plan that was paid for. */
export async function createAccountFromDraft(
  tx: Prisma.TransactionClient,
  draft: ShopkeeperDraft,
  order: Pick<PaymentOrder, "planType" | "razorpayOrderId">,
  razorpayPaymentId: string,
): Promise<{ shopkeeperId: string }> {
  if (!isPlanId(order.planType)) throw new Error(`Order has an unknown plan: ${order.planType}`);
  const planType = order.planType;
  const data = draft.data as Record<string, unknown>;
  const latitude = optionalNumber(data.latitude);
  const longitude = optionalNumber(data.longitude);

  const shopkeeper = await tx.shopkeeper.create({
    data: {
      email: draft.email,
      passwordHash: draft.passwordHash,
      shopName: text(data.shopName),
      shopCategory: text(data.shopCategory),
      address: text(data.address),
      city: text(data.city),
      state: text(data.state),
      pincode: text(data.pincode),
      latitude,
      longitude,
      phoneNumber: text(data.phoneNumber),
      logoUrl: optionalText(data.logoUrl),
      planType,
      planExpiresAt: planEndsAt(planType, null),
      razorpayOrderId: order.razorpayOrderId,
      razorpayPaymentId,
    },
  });

  const shop = await tx.shop.create({
    data: {
      ownerId: shopkeeper.id,
      shopName: text(data.shopName),
      category: text(data.shopCategory),
      description: optionalText(data.description),
      logoUrl: optionalText(data.logoUrl),
      address: text(data.address),
      city: text(data.city),
      state: text(data.state),
      pincode: text(data.pincode),
      phoneNumber: text(data.phoneNumber),
      latitude,
      longitude,
      coordinates: latitude !== null && longitude !== null ? { type: "Point", coordinates: [longitude, latitude] } : undefined,
    },
  });

  await tx.room.create({ data: { shopId: shop.id, inviteCode: await generateUniqueInviteCode(tx) } });
  await tx.shopkeeperDraft.delete({ where: { id: draft.id } });

  return { shopkeeperId: shopkeeper.id };
}

export type RegistrationOutcome = RegistrationResult & { tokenVersion: number };

/** What the sign-up screen needs once the account exists. */
export async function registrationResult(shopkeeperId: string): Promise<RegistrationOutcome> {
  const owner = await prisma.shopkeeper.findUniqueOrThrow({
    where: { id: shopkeeperId },
    select: { tokenVersion: true, shop: { select: { id: true, room: { select: { id: true, inviteCode: true } } } } },
  });
  const { shop } = owner;
  if (!shop?.room) throw new Error(`Account ${shopkeeperId} has no shop or room`);
  return {
    shopkeeperId,
    shopId: shop.id,
    roomId: shop.room.id,
    inviteCode: shop.room.inviteCode,
    inviteLink: buildInviteLink(shop.room.inviteCode),
    tokenVersion: owner.tokenVersion,
  };
}
