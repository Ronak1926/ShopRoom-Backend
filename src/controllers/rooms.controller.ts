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

  // 3. Build card objects with computed distance
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
    };
  });

  // 4. Filter by category
  if (category && category !== "All") {
    cards = cards.filter(
      (c) => c.category.toLowerCase() === category.toLowerCase(),
    );
  }

  // 5. Sort
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

  // 6. Trending — top 5 rooms by membersCount across ALL rooms (unfiltered)
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

  // 7. All distinct categories from DB
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
