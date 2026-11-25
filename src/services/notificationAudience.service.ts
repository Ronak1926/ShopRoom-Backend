/**
 * services/notificationAudience.service.ts — Turns an audience choice into the
 * concrete set of device tokens a send goes to.
 *
 * One SQL query decides the whole audience so distance, membership and opt-out
 * rules can never disagree with each other. Rules that always hold:
 *   - A member who switched notifications off for the room is never targeted,
 *     even if they are also inside the radius.
 *   - A customer is only "nearby" if they allow location access and their
 *     reported location is recent.
 *   - Every value reaches Postgres as a bound parameter.
 */

import { Prisma } from "../generated/client.js";
import { prisma } from "../database/prisma.js";
import { boundingBox, type LatLng } from "../utils/geo.js";

export type AudienceKind = "ROOM_MEMBERS" | "NEARBY" | "MEMBERS_NEARBY" | "MEMBERS_AND_NEARBY";

export interface AudienceSpec {
  roomId: string;
  kind: AudienceKind;
  /** Required for every kind except ROOM_MEMBERS. */
  radiusKm?: number;
  /** The shop's coordinates. Required for every kind except ROOM_MEMBERS. */
  center?: LatLng;
  /** Members who joined after this instant are left out of the "all members" leg. */
  membersJoinedBefore?: Date;
}

export interface AudienceDevice {
  deviceId: string;
  customerId: string;
  fcmToken: string;
}

/** Hard ceiling on one send's fan-out so a runaway audience can't exhaust memory. */
export const MAX_AUDIENCE_DEVICES = 50_000;

/** A customer's reported position stops counting as "right now" after this long. */
export const LOCATION_FRESH_HOURS = 48;

export function usesRadius(kind: AudienceKind): boolean {
  return kind !== "ROOM_MEMBERS";
}

/** The scheduling wizard's two independent legs, folded into one audience kind. */
export function kindFromLegs(includeMembers: boolean, includeNearby: boolean): AudienceKind {
  if (includeMembers && includeNearby) return "MEMBERS_AND_NEARBY";
  return includeNearby ? "NEARBY" : "ROOM_MEMBERS";
}

function withinRadius(center: LatLng, radiusKm: number, freshSince: Date): Prisma.Sql {
  const box = boundingBox(center, radiusKm);
  const lat = center.latitude;
  const lng = center.longitude;

  const parts: Prisma.Sql[] = [
    Prisma.sql`c."allowLocationAccess" = true`,
    Prisma.sql`c."locationUpdatedAt" >= ${freshSince}`,
    Prisma.sql`c."latitude" BETWEEN ${box.minLat}::double precision AND ${box.maxLat}::double precision`,
  ];
  if (box.minLng !== null && box.maxLng !== null) {
    parts.push(
      Prisma.sql`c."longitude" BETWEEN ${box.minLng}::double precision AND ${box.maxLng}::double precision`,
    );
  }
  // The box is only a cheap pre-filter; this is the exact great-circle test.
  parts.push(Prisma.sql`(
    2 * 6371 * asin(LEAST(1, sqrt(
      power(sin(radians(c."latitude" - ${lat}::double precision) / 2), 2) +
      cos(radians(${lat}::double precision)) * cos(radians(c."latitude")) *
      power(sin(radians(c."longitude" - ${lng}::double precision) / 2), 2)
    )))
  ) <= ${radiusKm}::double precision`);

  return Prisma.sql`(${Prisma.join(parts, " AND ")})`;
}

export function buildAudienceCondition(spec: AudienceSpec, now = new Date()): Prisma.Sql {
  const isMember = Prisma.sql`m."id" IS NOT NULL AND m."notificationsEnabled" = true`;
  const joinedClause = spec.membersJoinedBefore
    ? Prisma.sql` AND m."joinedAt" <= ${spec.membersJoinedBefore}`
    : Prisma.empty;

  const allMembers = Prisma.sql`(${isMember}${joinedClause})`;
  if (spec.kind === "ROOM_MEMBERS") return allMembers;

  if (!spec.center || !spec.radiusKm) {
    throw new Error("A radius audience needs shop coordinates and a radius");
  }
  const freshSince = new Date(now.getTime() - LOCATION_FRESH_HOURS * 3_600_000);
  const near = withinRadius(spec.center, spec.radiusKm, freshSince);

  const membersNearby = Prisma.sql`(${isMember} AND ${near})`;
  const outsidersNearby = Prisma.sql`(m."id" IS NULL AND ${near})`;

  switch (spec.kind) {
    case "MEMBERS_NEARBY":
      return membersNearby;
    case "NEARBY":
      return Prisma.sql`(${membersNearby} OR ${outsidersNearby})`;
    case "MEMBERS_AND_NEARBY":
      return Prisma.sql`(${allMembers} OR ${membersNearby} OR ${outsidersNearby})`;
  }
}

export async function resolveAudienceDevices(spec: AudienceSpec): Promise<AudienceDevice[]> {
  const condition = buildAudienceCondition(spec);
  return prisma.$queryRaw<AudienceDevice[]>(Prisma.sql`
    SELECT d."id" AS "deviceId", d."customerId" AS "customerId", d."fcmToken" AS "fcmToken"
    FROM "CustomerDevice" d
    JOIN "Customer" c ON c."id" = d."customerId"
    LEFT JOIN "Membership" m ON m."customerId" = c."id" AND m."roomId" = ${spec.roomId}
    WHERE ${condition}
    ORDER BY d."id"
    LIMIT ${MAX_AUDIENCE_DEVICES}
  `);
}
