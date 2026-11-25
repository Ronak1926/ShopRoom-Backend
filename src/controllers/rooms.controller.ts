/**
 * controllers/rooms.controller.ts — HTTP layer for room discovery, the map and
 * room details. Ranking, filtering and paging live in services/roomDiscovery.service.ts.
 *
 * GET /api/rooms/discover
 *   Auth     : customer JWT
 *   Query    : ?category=Clothing  (optional)
 *              ?sort=nearest|popular  (default: nearest)
 *              ?page=0  (0-based, default 0)
 *              ?limit=30  (default 30, max 30)
 *   Response : { total, page, limit, totalPages, rooms[], trending[], categories[] }
 *
 * Distance uses the authenticated customer's stored position, only when they
 * have allowed location access; otherwise distanceKm is null on every card.
 */

import type { Request, Response } from "express";
import { createHash } from "node:crypto";
import z from "zod";
import { prisma } from "../database/prisma.js";
import { assertRoomAccess, type SenderContext } from "../services/message.service.js";
import {
  DISCOVER_MAX_LIMIT,
  ROOM_MEMBERS_DEFAULT_LIMIT,
  ROOM_MEMBERS_MAX_LIMIT,
  discoverRooms as discoverRoomsService,
  listRoomMembers,
  mapPinsFor,
} from "../services/roomDiscovery.service.js";

/**
 * A paging number from the query string: malformed values become the default,
 * out-of-range values are clamped into [min, max] instead of failing the page.
 */
const pagingNumber = (min: number, max: number, fallback: number) =>
  z.coerce
    .number()
    .catch(fallback)
    .transform((n) => (Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : fallback));

const discoverQuerySchema = z.object({
  category: z.string().trim().max(60).optional().catch(undefined),
  sort: z.enum(["nearest", "popular"]).catch("nearest"),
  page: pagingNumber(0, 10_000, 0),
  limit: pagingNumber(1, DISCOVER_MAX_LIMIT, DISCOVER_MAX_LIMIT),
});

// ── GET /api/rooms/discover ────────────────────────────────────────────────────

export async function discoverRooms(req: Request, res: Response): Promise<void> {
  const query = discoverQuerySchema.parse(req.query);
  res.json(await discoverRoomsService(req.customerId!, query));
}

// ── GET /api/rooms/map-pins ────────────────────────────────────────────────────
// Lightweight pin data for shops with a position, most popular first, capped at
// MAP_PIN_LIMIT (`truncated` says when the cap cut the list; send a bounding box
// to see the rest). Optional bbox: ?swLat=&swLng=&neLat=&neLng=
// Cached briefly on the client and revalidated with an ETag.

const coordinate = (limit: number) => z.coerce.number().finite().min(-limit).max(limit);
const boundsSchema = z.object({
  swLat: coordinate(90),
  swLng: coordinate(180),
  neLat: coordinate(90),
  neLng: coordinate(180),
});

export async function mapPins(req: Request, res: Response): Promise<void> {
  const bounds = boundsSchema.safeParse(req.query);
  const { pins, truncated } = await mapPinsFor(req.customerId!, bounds.success ? bounds.data : null);

  const etag = `"${createHash("sha1")
    .update(pins.map((p) => `${p.shopId}:${p.membersCount}`).join(","))
    .digest("base64url")
    .slice(0, 27)}"`;
  res.setHeader("ETag", etag);
  res.setHeader("Cache-Control", "private, max-age=30");

  if (req.headers["if-none-match"] === etag) {
    res.status(304).end();
    return;
  }
  res.json({ total: pins.length, truncated, pins });
}

// ── GET /api/rooms/:roomId ─────────────────────────────────────────────────────
// Bootstrap data for a room's chat page — either a member customer or the
// shop's own owner may fetch it. Auth: requireAnyAuth.

export async function getRoomDetails(req: Request, res: Response): Promise<void> {
  const { roomId } = req.params as { roomId: string };
  const ctx: SenderContext = req.customerId
    ? { customerId: req.customerId }
    : { shopkeeperId: req.shopkeeperId! };

  try {
    await assertRoomAccess(roomId, ctx);
  } catch (err: unknown) {
    const e = err as Error;
    if (e.message === "Room not found") {
      res.status(404).json({ message: "Room not found" });
      return;
    }
    res.status(403).json({ message: "You don't have access to this room" });
    return;
  }

  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: {
      id: true,
      inviteCode: true,
      membersCount: true,
      createdAt: true,
      shop: {
        select: {
          shopName: true,
          logoUrl: true,
          category: true,
          description: true,
          address: true,
          city: true,
          state: true,
          pincode: true,
          phoneNumber: true,
        },
      },
    },
  });
  if (!room) {
    res.status(404).json({ message: "Room not found" });
    return;
  }

  res.json({
    roomId: room.id,
    shopName: room.shop.shopName,
    logoUrl: room.shop.logoUrl,
    category: room.shop.category,
    description: room.shop.description,
    address: room.shop.address,
    city: room.shop.city,
    state: room.shop.state,
    pincode: room.shop.pincode,
    phoneNumber: room.shop.phoneNumber,
    membersCount: room.membersCount,
    inviteCode: room.inviteCode,
    createdAt: room.createdAt.toISOString(),
  });
}

// ── GET /api/rooms/:roomId/members ─────────────────────────────────────────────
// Member list for a room's "Room Info" view — shared by both a member
// customer and the shop's own owner. Newest members first, paged:
// ?page=0&limit=200 (max 500); `total` is the full member count.
// Auth: requireAnyAuth.

const membersQuerySchema = z.object({
  page: pagingNumber(0, 10_000, 0),
  limit: pagingNumber(1, ROOM_MEMBERS_MAX_LIMIT, ROOM_MEMBERS_DEFAULT_LIMIT),
});

export async function getRoomMembers(req: Request, res: Response): Promise<void> {
  const { roomId } = req.params as { roomId: string };
  const ctx: SenderContext = req.customerId
    ? { customerId: req.customerId }
    : { shopkeeperId: req.shopkeeperId! };

  let shop: { shopLat: number | null; shopLng: number | null };
  try {
    shop = await assertRoomAccess(roomId, ctx);
  } catch (err: unknown) {
    if ((err as Error).message === "Room not found") {
      res.status(404).json({ message: "Room not found" });
      return;
    }
    res.status(403).json({ message: "You don't have access to this room" });
    return;
  }

  const { page, limit } = membersQuerySchema.parse(req.query);
  res.json(await listRoomMembers(roomId, { lat: shop.shopLat, lng: shop.shopLng }, page, limit));
}
