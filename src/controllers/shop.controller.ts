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

// ─── GET /api/shop/dashboard ──────────────────────────────────────────────────
// Returns all real-time dashboard data for the authenticated shopkeeper.
// Auth: requireShopkeeperAuth

export async function getShopDashboard(
  req: Request,
  res: Response,
): Promise<void> {
  const shopkeeperId = req.shopkeeperId!;

  // Single query: shop + room + last 5 memberships for recent activity
  const shop = await prisma.shop.findUnique({
    where: { ownerId: shopkeeperId },
    select: {
      id: true,
      shopName: true,
      category: true,
      logoUrl: true,
      createdAt: true,
      room: {
        select: {
          id: true,
          inviteCode: true,
          membersCount: true,
          createdAt: true,
          memberships: {
            orderBy: { joinedAt: "desc" },
            take: 5,
            select: {
              id: true,
              joinedAt: true,
              customer: {
                select: { id: true, fullName: true },
              },
            },
          },
        },
      },
    },
  });

  if (!shop) {
    res.status(404).json({ message: "Shop not found" });
    return;
  }

  const room = shop.room;

  const recentJoins = room
    ? room.memberships.map((m) => ({
        id: m.id,
        customerName: m.customer.fullName,
        joinedAt: m.joinedAt.toISOString(),
      }))
    : [];

  res.json({
    shop: {
      shopName: shop.shopName,
      category: shop.category,
      logoUrl: shop.logoUrl ?? null,
      createdAt: shop.createdAt.toISOString(),
    },
    room: room
      ? {
          roomId: room.id,
          inviteCode: room.inviteCode,
          inviteLink: buildInviteLink(room.inviteCode),
          membersCount: room.membersCount,
          createdAt: room.createdAt.toISOString(),
        }
      : null,
    recentJoins,
  });
}

// ─── GET /api/shop/members ────────────────────────────────────────────────────
// Returns a paginated list of room members for the authenticated shopkeeper.
// Query params: page (0-based, default 0), limit (default 10, max 100)
// Auth: requireShopkeeperAuth

export async function getShopMembers(
  req: Request,
  res: Response,
): Promise<void> {
  const shopkeeperId = req.shopkeeperId!;

  const page = Math.max(
    0,
    parseInt((req.query.page as string) ?? "0", 10) || 0,
  );
  const limit = Math.min(
    100,
    Math.max(1, parseInt((req.query.limit as string) ?? "10", 10) || 10),
  );

  const shop = await prisma.shop.findUnique({
    where: { ownerId: shopkeeperId },
    select: {
      room: {
        select: {
          id: true,
          membersCount: true,
        },
      },
    },
  });

  if (!shop?.room) {
    res.json({ members: [], total: 0, page, limit, totalPages: 0 });
    return;
  }

  const [memberships, total] = await Promise.all([
    prisma.membership.findMany({
      where: { roomId: shop.room.id },
      orderBy: { joinedAt: "desc" },
      skip: page * limit,
      take: limit,
      select: {
        id: true,
        joinedAt: true,
        notificationsEnabled: true,
        customer: {
          select: { id: true, fullName: true, email: true },
        },
      },
    }),
    prisma.membership.count({ where: { roomId: shop.room.id } }),
  ]);

  const members = memberships.map((m) => ({
    id: m.id,
    customerId: m.customer.id,
    customerName: m.customer.fullName,
    email: m.customer.email,
    joinedAt: m.joinedAt.toISOString(),
    notificationsEnabled: m.notificationsEnabled,
  }));

  res.json({
    members,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
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

// ─── GET /api/shop/profile ──────────────────────────────────────────────────
// Returns full profile data for the authenticated shopkeeper:
// shopkeeper account fields + shop details + plan + room quick-stats.
// Auth: requireShopkeeperAuth

export async function getShopProfile(
  req: Request,
  res: Response,
): Promise<void> {
  const shopkeeperId = req.shopkeeperId!;

  const [shopkeeper, shop] = await Promise.all([
    prisma.shopkeeper.findUnique({
      where: { id: shopkeeperId },
      select: {
        id: true,
        email: true,
        planType: true,
        planExpiresAt: true,
        createdAt: true,
      },
    }),
    prisma.shop.findUnique({
      where: { ownerId: shopkeeperId },
      select: {
        shopName: true,
        category: true,
        description: true,
        logoUrl: true,
        address: true,
        city: true,
        state: true,
        pincode: true,
        phoneNumber: true,
        latitude: true,
        longitude: true,
        createdAt: true,
        room: {
          select: {
            inviteCode: true,
            coverUrl: true,
            membersCount: true,
            createdAt: true,
          },
        },
      },
    }),
  ]);

  if (!shopkeeper || !shop) {
    res.status(404).json({ message: "Shop not found" });
    return;
  }

  res.set("Cache-Control", "private, max-age=30");
  res.json({
    shopkeeper: {
      id: shopkeeper.id,
      email: shopkeeper.email,
      createdAt: shopkeeper.createdAt.toISOString(),
    },
    shop: {
      shopName: shop.shopName,
      category: shop.category,
      description: shop.description ?? null,
      logoUrl: shop.logoUrl ?? null,
      address: shop.address,
      city: shop.city,
      state: shop.state,
      pincode: shop.pincode,
      phoneNumber: shop.phoneNumber,
      latitude: shop.latitude ?? null,
      longitude: shop.longitude ?? null,
      createdAt: shop.createdAt.toISOString(),
    },
    plan: {
      planType: shopkeeper.planType,
      planExpiresAt: shopkeeper.planExpiresAt.toISOString(),
    },
    room: shop.room
      ? {
          inviteCode: shop.room.inviteCode,
          coverUrl: shop.room.coverUrl ?? null,
          membersCount: shop.room.membersCount,
          createdAt: shop.room.createdAt.toISOString(),
        }
      : null,
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
