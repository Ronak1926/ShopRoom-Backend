/**
 * services/roomDiscovery.service.ts — Room discovery, map pins and member lists.
 *
 * Filtering, ordering and paging happen in the database. These used to load
 * every room (or every shop, or every member) into memory per request and sort
 * there, which is fine for a demo and a latency and memory problem at scale.
 */

import { Prisma } from "../generated/client.js";
import { prisma } from "../database/prisma.js";
import { haversineKm } from "../utils/geo.js";

export const DISCOVER_MAX_LIMIT = 30;
export const MAP_PIN_LIMIT = 500;
export const ROOM_MEMBERS_DEFAULT_LIMIT = 200;
export const ROOM_MEMBERS_MAX_LIMIT = 500;

export interface Position {
  latitude: number;
  longitude: number;
}

/** The customer's position, only when they have allowed location use. */
async function consentedPosition(customerId: string): Promise<Position | null> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { allowLocationAccess: true, latitude: true, longitude: true },
  });
  if (!customer?.allowLocationAccess || customer.latitude === null || customer.longitude === null) {
    return null;
  }
  return { latitude: customer.latitude, longitude: customer.longitude };
}

const roundKm = (km: number) => Math.round(km * 10) / 10;

// ── Discover ──────────────────────────────────────────────────────────────────

export interface DiscoverQuery {
  category?: string;
  sort: "nearest" | "popular";
  page: number;
  limit: number;
}

const roomCardSelect = {
  id: true,
  coverUrl: true,
  membersCount: true,
  inviteCode: true,
  shop: {
    select: { shopName: true, category: true, logoUrl: true, city: true, latitude: true, longitude: true },
  },
} satisfies Prisma.RoomSelect;

type RoomRow = Prisma.RoomGetPayload<{ select: typeof roomCardSelect }>;

/** SQL for the great-circle distance in km from `from` to a shop row `s`; NULL when the shop has no position. */
function distanceSql(from: Position): Prisma.Sql {
  return Prisma.sql`CASE WHEN s."latitude" IS NULL OR s."longitude" IS NULL THEN NULL ELSE
    12742 * asin(sqrt(least(1,
      power(sin(radians(s."latitude" - ${from.latitude}::float8) / 2), 2) +
      cos(radians(${from.latitude}::float8)) * cos(radians(s."latitude")) *
      power(sin(radians(s."longitude" - ${from.longitude}::float8) / 2), 2)))) END`;
}

export async function discoverRooms(customerId: string, query: DiscoverQuery) {
  const position = await consentedPosition(customerId);
  const categoryFilter =
    query.category && query.category !== "All"
      ? { shop: { category: { equals: query.category, mode: "insensitive" as const } } }
      : {};
  const offset = query.page * query.limit;

  // Order the page. "nearest" ranks by distance in SQL (rooms without a known
  // distance last); "popular" ranks by member count.
  let rows: RoomRow[];
  let distances = new Map<string, number | null>();

  if (query.sort === "popular") {
    rows = await prisma.room.findMany({
      where: categoryFilter,
      orderBy: [{ membersCount: "desc" }, { id: "asc" }],
      skip: offset,
      take: query.limit,
      select: roomCardSelect,
    });
  } else {
    const categorySql =
      query.category && query.category !== "All"
        ? Prisma.sql`WHERE lower(s."category") = lower(${query.category})`
        : Prisma.empty;
    const distance = position ? distanceSql(position) : Prisma.sql`NULL::float8`;
    const ranked = await prisma.$queryRaw<{ id: string; distance: number | null }[]>(Prisma.sql`
      SELECT r."id", ${distance} AS "distance"
      FROM "Room" r
      JOIN "Shop" s ON s."id" = r."shopId"
      ${categorySql}
      ORDER BY "distance" ASC NULLS LAST, r."id" ASC
      LIMIT ${query.limit} OFFSET ${offset}
    `);
    distances = new Map(ranked.map((r) => [r.id, r.distance]));
    const found = await prisma.room.findMany({
      where: { id: { in: ranked.map((r) => r.id) } },
      select: roomCardSelect,
    });
    const byId = new Map(found.map((room) => [room.id, room]));
    rows = ranked.flatMap((r) => byId.get(r.id) ?? []);
  }

  const pageIds = rows.map((room) => room.id);
  const [total, joined, trendingRows, categoryRows] = await Promise.all([
    prisma.room.count({ where: categoryFilter }),
    pageIds.length
      ? prisma.membership.findMany({ where: { customerId, roomId: { in: pageIds } }, select: { roomId: true } })
      : Promise.resolve([]),
    prisma.room.findMany({
      orderBy: [{ membersCount: "desc" }, { id: "asc" }],
      take: 5,
      select: { id: true, membersCount: true, shop: { select: { shopName: true, category: true, logoUrl: true } } },
    }),
    prisma.shop.groupBy({ by: ["category"], orderBy: { category: "asc" } }),
  ]);
  const joinedIds = new Set(joined.map((m) => m.roomId));

  const rooms = rows.map((room) => {
    const km =
      query.sort === "nearest"
        ? (distances.get(room.id) ?? null)
        : position && room.shop.latitude !== null && room.shop.longitude !== null
          ? haversineKm(position, { latitude: room.shop.latitude, longitude: room.shop.longitude })
          : null;
    return {
      roomId: room.id,
      shopName: room.shop.shopName,
      category: room.shop.category,
      logoUrl: room.shop.logoUrl,
      coverUrl: room.coverUrl,
      membersCount: room.membersCount,
      inviteCode: room.inviteCode,
      city: room.shop.city,
      distanceKm: km === null ? null : roundKm(km),
      likes: 200, // static for now
      activeNow: true, // static for now
      isJoined: joinedIds.has(room.id),
    };
  });

  return {
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.ceil(total / query.limit),
    rooms,
    trending: trendingRows.map((room) => ({
      roomId: room.id,
      shopName: room.shop.shopName,
      category: room.shop.category,
      logoUrl: room.shop.logoUrl,
      membersCount: room.membersCount,
    })),
    categories: categoryRows.map((row) => row.category),
  };
}

// ── Map pins ──────────────────────────────────────────────────────────────────

export interface Bounds {
  swLat: number;
  swLng: number;
  neLat: number;
  neLng: number;
}

export async function mapPinsFor(customerId: string, bounds: Bounds | null) {
  const position = await consentedPosition(customerId);

  // One more than the cap tells us whether the result was cut off.
  const shops = await prisma.shop.findMany({
    where: {
      room: { isNot: null },
      ...(bounds
        ? {
            latitude: { gte: bounds.swLat, lte: bounds.neLat },
            longitude: { gte: bounds.swLng, lte: bounds.neLng },
          }
        : { latitude: { not: null }, longitude: { not: null } }),
    },
    orderBy: [{ room: { membersCount: "desc" } }, { id: "asc" }],
    take: MAP_PIN_LIMIT + 1,
    select: {
      id: true,
      shopName: true,
      category: true,
      logoUrl: true,
      latitude: true,
      longitude: true,
      city: true,
      room: { select: { id: true, membersCount: true, coverUrl: true, inviteCode: true } },
    },
  });

  const truncated = shops.length > MAP_PIN_LIMIT;
  const pins = shops.slice(0, MAP_PIN_LIMIT).flatMap((s) => {
    if (!s.room || s.latitude === null || s.longitude === null) return [];
    const km = position ? haversineKm(position, { latitude: s.latitude, longitude: s.longitude }) : null;
    return [
      {
        shopId: s.id,
        roomId: s.room.id,
        shopName: s.shopName,
        category: s.category,
        logoUrl: s.logoUrl,
        coverUrl: s.room.coverUrl,
        inviteCode: s.room.inviteCode,
        membersCount: s.room.membersCount,
        lat: s.latitude,
        lng: s.longitude,
        city: s.city,
        distanceKm: km === null ? null : roundKm(km),
      },
    ];
  });
  return { pins, truncated };
}

// ── Room members ──────────────────────────────────────────────────────────────

export async function listRoomMembers(
  roomId: string,
  shopPosition: { lat: number | null; lng: number | null },
  page: number,
  limit: number,
) {
  const [memberships, total] = await Promise.all([
    prisma.membership.findMany({
      where: { roomId },
      orderBy: [{ joinedAt: "desc" }, { id: "asc" }],
      skip: page * limit,
      take: limit,
      select: {
        joinedAt: true,
        customer: {
          select: { id: true, fullName: true, allowLocationAccess: true, latitude: true, longitude: true },
        },
      },
    }),
    prisma.membership.count({ where: { roomId } }),
  ]);

  const members = memberships.map((m) => {
    const hasPosition =
      shopPosition.lat !== null &&
      shopPosition.lng !== null &&
      m.customer.allowLocationAccess &&
      m.customer.latitude !== null &&
      m.customer.longitude !== null;
    return {
      customerId: m.customer.id,
      customerName: m.customer.fullName,
      joinedAt: m.joinedAt.toISOString(),
      distanceKm: hasPosition
        ? roundKm(
            haversineKm(
              { latitude: shopPosition.lat!, longitude: shopPosition.lng! },
              { latitude: m.customer.latitude!, longitude: m.customer.longitude! },
            ),
          )
        : null,
    };
  });
  return { members, total, page, limit, hasMore: (page + 1) * limit < total };
}
