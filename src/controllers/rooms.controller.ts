/**
 * controllers/rooms.controller.ts
 *
 * GET /api/rooms/discover
 *   Auth     : customer JWT
 *   Query    : ?category=Clothing  (optional)
 *              ?sort=nearest|popular  (default: nearest)
 *   Response : { total, rooms[], trending[], categories[] }
 *
 * Distance is computed server-side with the Haversine formula using
 * the authenticated customer's stored lat/lng.  If the customer has
 * not granted location access, distanceKm is null for every card.
 */

import type { Request, Response } from "express";
import { prisma } from "../database/prisma.js";
import { assertRoomAccess, type SenderContext } from "../services/message.service.js";

// ── Haversine distance (km) ────────────────────────────────────────────────────

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── GET /api/rooms/discover ────────────────────────────────────────────────────

export async function discoverRooms(
  req: Request,
  res: Response,
): Promise<void> {
  const customerId = req.customerId!;
  const { category, sort = "nearest" } = req.query as {
    category?: string;
    sort?: string;
  };

  // 1. Fetch authenticated customer's location
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      allowLocationAccess: true,
      latitude: true,
      longitude: true,
    },
  });

  const hasLocation =
    !!customer?.allowLocationAccess &&
    customer.latitude != null &&
    customer.longitude != null;

  const cusLat = hasLocation ? customer!.latitude! : null;
  const cusLng = hasLocation ? customer!.longitude! : null;

  // 2. Fetch ALL rooms (with shop info) — we filter & sort in-process
  const allRooms = await prisma.room.findMany({
    include: {
      shop: {
        select: {
          shopName: true,
          category: true,
          logoUrl: true,
          city: true,
          state: true,
          latitude: true,
          longitude: true,
        },
      },
    },
  });

  // 3. Which of these rooms is the customer already a member of?
  const memberships = await prisma.membership.findMany({
    where: {
      customerId,
      roomId: { in: allRooms.map((r) => r.id) },
    },
    select: { roomId: true },
  });
  const joinedRoomIds = new Set(memberships.map((m) => m.roomId));

  // 4. Build card objects with computed distance
  type RoomCard = {
    roomId: string;
    shopName: string;
    category: string;
    logoUrl: string | null;
    coverUrl: string | null;
    membersCount: number;
    inviteCode: string;
    city: string;
    distanceKm: number | null;
    likes: number;
    activeNow: boolean;
    isJoined: boolean;
  };

  let cards: RoomCard[] = allRooms.map((room) => {
    let distanceKm: number | null = null;
    if (
      cusLat !== null &&
      cusLng !== null &&
      room.shop.latitude != null &&
      room.shop.longitude != null
    ) {
      distanceKm =
        Math.round(
          haversineKm(cusLat, cusLng, room.shop.latitude, room.shop.longitude) *
            10,
        ) / 10;
    }

    return {
      roomId: room.id,
      shopName: room.shop.shopName,
      category: room.shop.category,
      logoUrl: room.shop.logoUrl,
      coverUrl: room.coverUrl,
      membersCount: room.membersCount,
      inviteCode: room.inviteCode,
      city: room.shop.city,
      distanceKm,
      likes: 200, // static for now
      activeNow: true, // static for now
      isJoined: joinedRoomIds.has(room.id),
    };
  });

  // 5. Filter by category
  if (category && category !== "All") {
    cards = cards.filter(
      (c) => c.category.toLowerCase() === category.toLowerCase(),
    );
  }

  // 6. Sort
  if (sort === "popular") {
    cards.sort((a, b) => b.membersCount - a.membersCount);
  } else {
    // nearest: rooms with known distance first (ascending), then unknown
    cards.sort((a, b) => {
      if (a.distanceKm === null && b.distanceKm === null) return 0;
      if (a.distanceKm === null) return 1;
      if (b.distanceKm === null) return -1;
      return a.distanceKm - b.distanceKm;
    });
  }

  // 7. Trending — top 5 rooms by membersCount across ALL rooms (unfiltered)
  const trending = [...allRooms]
    .sort((a, b) => b.membersCount - a.membersCount)
    .slice(0, 5)
    .map((room) => ({
      roomId: room.id,
      shopName: room.shop.shopName,
      category: room.shop.category,
      logoUrl: room.shop.logoUrl,
      membersCount: room.membersCount,
    }));

  // 8. All distinct categories from DB
  const categoryRows = await prisma.shop.findMany({
    distinct: ["category"],
    select: { category: true },
    orderBy: { category: "asc" },
  });
  const categories = categoryRows.map((r) => r.category);

  res.json({
    total: cards.length,
    rooms: cards,
    trending,
    categories,
  });
}

// ── GET /api/rooms/map-pins ────────────────────────────────────────────────────
// Returns lightweight pin data for all shops with lat/lng.
// Optional bbox filter: ?swLat=&swLng=&neLat=&neLng=
// Used by the map – cached aggressively on the client.

export async function mapPins(req: Request, res: Response): Promise<void> {
  const customerId = req.customerId!;
  const { swLat, swLng, neLat, neLng } = req.query as Record<string, string>;

  // Customer location for distance calc
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { allowLocationAccess: true, latitude: true, longitude: true },
  });
  const hasLocation =
    !!customer?.allowLocationAccess &&
    customer.latitude != null &&
    customer.longitude != null;

  const shops = await prisma.shop.findMany({
    where: {
      latitude: { not: null },
      longitude: { not: null },
    },
    select: {
      id: true,
      shopName: true,
      category: true,
      logoUrl: true,
      latitude: true,
      longitude: true,
      city: true,
      room: {
        select: {
          id: true,
          membersCount: true,
          coverUrl: true,
          inviteCode: true,
        },
      },
    },
  });

  // Filter by bbox if provided
  const hasBbox =
    swLat !== undefined &&
    swLng !== undefined &&
    neLat !== undefined &&
    neLng !== undefined;

  const filtered = hasBbox
    ? shops.filter((s) => {
        const lat = s.latitude!;
        const lng = s.longitude!;
        return (
          lat >= parseFloat(swLat) &&
          lat <= parseFloat(neLat) &&
          lng >= parseFloat(swLng) &&
          lng <= parseFloat(neLng)
        );
      })
    : shops;

  const pins = filtered
    .filter((s) => s.room !== null)
    .map((s) => {
      let distanceKm: number | null = null;
      if (hasLocation) {
        distanceKm =
          Math.round(
            haversineKm(
              customer!.latitude!,
              customer!.longitude!,
              s.latitude!,
              s.longitude!,
            ) * 10,
          ) / 10;
      }
      return {
        shopId: s.id,
        roomId: s.room!.id,
        shopName: s.shopName,
        category: s.category,
        logoUrl: s.logoUrl,
        coverUrl: s.room!.coverUrl,
        inviteCode: s.room!.inviteCode,
        membersCount: s.room!.membersCount,
        lat: s.latitude!,
        lng: s.longitude!,
        city: s.city,
        distanceKm,
      };
    });

  // ETag for caching: hash of shop IDs + membersCount
  const etag = `"${Buffer.from(
    pins.map((p) => `${p.shopId}:${p.membersCount}`).join(","),
  )
    .toString("base64")
    .slice(0, 32)}"`;

  res.setHeader("ETag", etag);
  res.setHeader("Cache-Control", "private, max-age=30");

  if (req.headers["if-none-match"] === etag) {
    res.status(304).end();
    return;
  }

  res.json({ total: pins.length, pins });
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
// customer and the shop's own owner. Auth: requireAnyAuth.

export async function getRoomMembers(req: Request, res: Response): Promise<void> {
  const { roomId } = req.params as { roomId: string };
  const ctx: SenderContext = req.customerId
    ? { customerId: req.customerId }
    : { shopkeeperId: req.shopkeeperId! };

  let shopLat: number | null;
  let shopLng: number | null;
  try {
    ({ shopLat, shopLng } = await assertRoomAccess(roomId, ctx));
  } catch (err: unknown) {
    const e = err as Error;
    if (e.message === "Room not found") {
      res.status(404).json({ message: "Room not found" });
      return;
    }
    res.status(403).json({ message: "You don't have access to this room" });
    return;
  }

  const memberships = await prisma.membership.findMany({
    where: { roomId },
    orderBy: { joinedAt: "desc" },
    select: {
      joinedAt: true,
      customer: {
        select: {
          id: true,
          fullName: true,
          allowLocationAccess: true,
          latitude: true,
          longitude: true,
        },
      },
    },
  });

  res.json({
    members: memberships.map((m) => {
      let distanceKm: number | null = null;
      if (
        shopLat != null &&
        shopLng != null &&
        m.customer.allowLocationAccess &&
        m.customer.latitude != null &&
        m.customer.longitude != null
      ) {
        distanceKm =
          Math.round(
            haversineKm(shopLat, shopLng, m.customer.latitude, m.customer.longitude) *
              10,
          ) / 10;
      }
      return {
        customerId: m.customer.id,
        customerName: m.customer.fullName,
        joinedAt: m.joinedAt.toISOString(),
        distanceKm,
      };
    }),
    total: memberships.length,
  });
}
