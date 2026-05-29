/**
 * controllers/shop.controller.ts — HTTP handlers for shop + room endpoints.
 *
 * All handlers follow the pattern: validate → service call → respond.
 * Business logic lives exclusively in the service layer.
 */

import type { Request, Response } from "express";
import { prisma } from "../database/prisma.js";
import {
  getRoomByInviteCode,
  joinRoom,
  leaveRoom,
} from "../services/room.service.js";
import { buildInviteLink } from "../utils/inviteCode.js";
import { uploadImageToCloudinary } from "../lib/cloudinary.js";
import type { GeoJsonPoint } from "../types/index.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toGeoJson(
  lat: number | null,
  lng: number | null,
): GeoJsonPoint | null {
  if (lat == null || lng == null) return null;
  return { type: "Point", coordinates: [lng, lat] };
}

// ─── GET /api/shop/me ─────────────────────────────────────────────────────────
// Returns the authenticated shopkeeper's shop + room details.
// Auth: requireShopkeeperAuth (sets req.shopkeeperId)

export async function getMyShop(req: Request, res: Response): Promise<void> {
  const shopkeeperId = req.shopkeeperId!;

  const shop = await prisma.shop.findUnique({
    where: { ownerId: shopkeeperId },
    include: {
      room: {
        select: {
          id: true,
          inviteCode: true,
          membersCount: true,
          coverUrl: true,
          createdAt: true,
        },
      },
    },
  });

  if (!shop) {
    res.status(404).json({ message: "Shop not found" });
    return;
  }

  res.json({
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
    room: shop.room
      ? {
          roomId: shop.room.id,
          inviteCode: shop.room.inviteCode,
          inviteLink: buildInviteLink(shop.room.inviteCode),
          membersCount: shop.room.membersCount,
          coverUrl: shop.room.coverUrl ?? null,
          createdAt: shop.room.createdAt.toISOString(),
        }
      : null,
    createdAt: shop.createdAt.toISOString(),
  });
}

// ─── GET /api/shop/invite/:code ───────────────────────────────────────────────
// Public — returns shop preview for the invite link page.

export async function getInvitePreview(
  req: Request,
  res: Response,
): Promise<void> {
  const { code } = req.params as { code: string };

  try {
    const preview = await getRoomByInviteCode(code.toUpperCase());
    res.json(preview);
  } catch (err: unknown) {
    const e = err as Error;
    if (e.message === "Invite code not found") {
      res.status(404).json({ message: "Invalid or expired invite link" });
      return;
    }
    console.error("[shop] getInvitePreview:", e.message);
    res.status(500).json({ message: "Something went wrong" });
  }
}

// ─── POST /api/shop/join/:code ────────────────────────────────────────────────
// Customer joins a shop's room via invite code.
// Auth: requireCustomerAuth (sets req.customerId)

export async function joinShopRoom(req: Request, res: Response): Promise<void> {
  const { code } = req.params as { code: string };
  const customerId = req.customerId!;

  try {
    const result = await joinRoom(code.toUpperCase(), customerId);

    res.status(result.alreadyMember ? 200 : 201).json({
      message: result.alreadyMember
        ? `You are already a member of ${result.shopName}`
        : `Joined ${result.shopName} successfully`,
      roomId: result.roomId,
      alreadyMember: result.alreadyMember,
    });
  } catch (err: unknown) {
    const e = err as Error;
    if (e.message === "Invite code not found") {
      res.status(404).json({ message: "Invalid or expired invite link" });
      return;
    }
    console.error("[shop] joinShopRoom:", e.message);
    res.status(500).json({ message: "Something went wrong" });
  }
}

// ─── DELETE /api/shop/room/:roomId/leave ─────────────────────────────────────
// Customer leaves a room.
// Auth: requireCustomerAuth (sets req.customerId)

export async function leaveShopRoom(
  req: Request,
  res: Response,
): Promise<void> {
  const { roomId } = req.params as { roomId: string };
  const customerId = req.customerId!;

  try {
    await leaveRoom(roomId, customerId);
    res.json({ message: "Left the room" });
  } catch (err: unknown) {
    const e = err as Error;
    console.error("[shop] leaveShopRoom:", e.message);
    res.status(500).json({ message: "Something went wrong" });
  }
}

// ─── PATCH /api/shop/room/images ───────────────────────────────────────────────
// Shopkeeper updates their shop logo and/or room cover image.
// Both fields are optional; at least one must be supplied.
// Body: { logoBase64?: string; coverBase64?: string }
// Auth: requireShopkeeperAuth

export async function updateRoomImages(
  req: Request,
  res: Response,
): Promise<void> {
  const shopkeeperId = req.shopkeeperId!;
  const { logoBase64, coverBase64 } = req.body as {
    logoBase64?: string;
    coverBase64?: string;
  };

  if (!logoBase64 && !coverBase64) {
    res
      .status(400)
      .json({ message: "Provide at least one of logoBase64 or coverBase64" });
    return;
  }

  const shop = await prisma.shop.findUnique({
    where: { ownerId: shopkeeperId },
    include: { room: { select: { id: true } } },
  });

  if (!shop) {
    res.status(404).json({ message: "Shop not found" });
    return;
  }

  try {
    let logoUrl: string | undefined;
    let coverUrl: string | undefined;

    // Upload both in parallel if both provided
    const [resolvedLogo, resolvedCover] = await Promise.all([
      logoBase64
        ? uploadImageToCloudinary(logoBase64, "shoproom/logos")
        : Promise.resolve(undefined),
      coverBase64
        ? uploadImageToCloudinary(coverBase64, "shoproom/covers")
        : Promise.resolve(undefined),
    ]);

    logoUrl = resolvedLogo;
    coverUrl = resolvedCover;

    if (logoUrl) {
      await prisma.shop.update({
        where: { id: shop.id },
        data: { logoUrl },
      });
    }

    if (coverUrl && shop.room) {
      await prisma.room.update({
        where: { id: shop.room.id },
        data: { coverUrl },
      });
    }

    res.json({
      message: "Images updated successfully",
      logoUrl: logoUrl ?? null,
      coverUrl: coverUrl ?? null,
    });
  } catch (err: unknown) {
    const e = err as Error;
    console.error("[shop] updateRoomImages:", e.message);
    res.status(500).json({ message: "Failed to upload images" });
  }
}
