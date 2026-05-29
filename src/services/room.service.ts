/**
 * services/room.service.ts — Room and Membership business logic.
 *
 * Responsibilities:
 *  • Join a room via invite code (idempotent — rejoining is a no-op)
 *  • Leave a room
 *  • Get room details with shop info (used by the invite-link preview page)
 *
 * The Room creation itself lives in shopkeeper.service.ts inside the
 * payment-verification transaction — rooms are NEVER created directly.
 */

import { prisma } from "../database/prisma.js";
import type { InvitePreview, GeoJsonPoint } from "../types/index.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toGeoJson(
  lat: number | null,
  lng: number | null,
): GeoJsonPoint | null {
  if (lat == null || lng == null) return null;
  return { type: "Point", coordinates: [lng, lat] };
}

// ─── Public ───────────────────────────────────────────────────────────────────

/**
 * Returns the invite-link preview for a given code.
 * Used by GET /api/shop/invite/:code — no auth required.
 *
 * Throws if the code doesn't exist.
 */
export async function getRoomByInviteCode(
  inviteCode: string,
): Promise<InvitePreview> {
  const room = await prisma.room.findUnique({
    where: { inviteCode },
    include: {
      shop: true,
    },
  });

  if (!room) throw new Error("Invite code not found");

  const { shop } = room;

  return {
    shop: {
      shopId: shop.id,
      shopName: shop.shopName,
      category: shop.category,
      description: shop.description,
      logoUrl: shop.logoUrl,
      address: shop.address,
      city: shop.city,
      state: shop.state,
      pincode: shop.pincode,
      phoneNumber: shop.phoneNumber,
      coordinates: toGeoJson(shop.latitude, shop.longitude),
      createdAt: shop.createdAt.toISOString(),
    },
    membersCount: room.membersCount,
    inviteCode: room.inviteCode,
  };
}

/**
 * Customer joins a shop's room via invite code.
 *
 * Idempotent: if the customer is already a member, returns their existing
 * membership silently (no error, no duplicate row).
 *
 * Side-effect: increments room.membersCount atomically.
 *
 * @returns `{ alreadyMember: boolean }`
 */
export async function joinRoom(
  inviteCode: string,
  customerId: string,
): Promise<{ alreadyMember: boolean; roomId: string; shopName: string }> {
  const room = await prisma.room.findUnique({
    where: { inviteCode },
    include: { shop: { select: { shopName: true } } },
  });

  if (!room) throw new Error("Invite code not found");

  // Check for existing membership
  const existing = await prisma.membership.findUnique({
    where: { roomId_customerId: { roomId: room.id, customerId } },
  });

  if (existing) {
    return {
      alreadyMember: true,
      roomId: room.id,
      shopName: room.shop.shopName,
    };
  }

  // Create membership + increment counter in a single transaction
  await prisma.$transaction([
    prisma.membership.create({
      data: { roomId: room.id, customerId },
    }),
    prisma.room.update({
      where: { id: room.id },
      data: { membersCount: { increment: 1 } },
    }),
  ]);

  return {
    alreadyMember: false,
    roomId: room.id,
    shopName: room.shop.shopName,
  };
}

/**
 * Customer leaves a room.
 *
 * Idempotent: if the customer is not a member, silently returns.
 * Side-effect: decrements room.membersCount (floor 0).
 */
export async function leaveRoom(
  roomId: string,
  customerId: string,
): Promise<void> {
  const membership = await prisma.membership.findUnique({
    where: { roomId_customerId: { roomId, customerId } },
  });

  if (!membership) return; // already not a member — no-op

  await prisma.$transaction([
    prisma.membership.delete({
      where: { roomId_customerId: { roomId, customerId } },
    }),
    prisma.room.update({
      where: { id: roomId },
      // Use Math.max equivalent: only decrement if count > 0
      data: {
        membersCount: {
          decrement: 1,
        },
      },
    }),
  ]);
}
