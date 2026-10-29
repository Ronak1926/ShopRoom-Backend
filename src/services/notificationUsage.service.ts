/**
 * services/notificationUsage.service.ts — Enforces the plan's daily send limit.
 *
 * "Today" is the calendar day in APP_TIMEZONE (default Asia/Kolkata) — the
 * backend has no per-shop time zone, and a single business day keeps the
 * counter the shopkeeper sees identical to the one that blocks them.
 */

import type { NotificationAudienceMode, Prisma } from "../generated/client.js";
import { prisma } from "../database/prisma.js";
import { NotificationError } from "../utils/notificationError.js";
import { startOfZonedDay, isValidTimeZone } from "../utils/zonedTime.js";
import { getPlanCapabilities } from "./notificationPlan.service.js";

const DEFAULT_TIME_ZONE = "Asia/Kolkata";

function appTimeZone(): string {
  const configured = process.env.APP_TIMEZONE;
  return configured && isValidTimeZone(configured) ? configured : DEFAULT_TIME_ZONE;
}

/** Sends that reached the push service count; ones that failed outright do not. */
const COUNTED_STATUSES = ["PENDING", "SENT"] as const;

type SendCounter = Pick<Prisma.TransactionClient, "notificationSend">;

function countToday(db: SendCounter, shopkeeperId: string, now = new Date()): Promise<number> {
  return db.notificationSend.count({
    where: {
      shopkeeperId,
      createdAt: { gte: startOfZonedDay(now, appTimeZone()) },
      status: { in: [...COUNTED_STATUSES] },
    },
  });
}

export function getSendsToday(shopkeeperId: string): Promise<number> {
  return countToday(prisma, shopkeeperId);
}

export function dailyLimitFor(planType: string | null | undefined): number {
  return getPlanCapabilities(planType).dailyNotificationLimit;
}

export function dailyLimitMessage(limit: number): string {
  return `You've reached today's limit of ${limit} notification${limit === 1 ? "" : "s"} on your plan. It resets at midnight.`;
}

/** Cheap early rejection so a doomed send doesn't pin a design version first. */
export async function assertUnderDailyLimit(
  shopkeeperId: string,
  planType: string | null | undefined,
): Promise<void> {
  const limit = dailyLimitFor(planType);
  if ((await getSendsToday(shopkeeperId)) >= limit) {
    throw NotificationError.tooManyRequests(dailyLimitMessage(limit));
  }
}

export interface NewSend {
  shopkeeperId: string;
  roomId: string;
  designVersionId: string;
  audience: NotificationAudienceMode;
  radiusKm: number | null;
  message: string | null;
  scheduleId?: string;
  scheduledFor?: Date;
}

/**
 * Creates the PENDING send row only if the shopkeeper is still under the daily
 * limit. The advisory lock serialises concurrent sends per shopkeeper, so two
 * requests racing at limit-1 can't both pass the count check.
 */
export async function reserveSend(
  send: NewSend,
  planType: string | null | undefined,
): Promise<{ id: string }> {
  const limit = dailyLimitFor(planType);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${send.shopkeeperId}))`;

    const used = await countToday(tx, send.shopkeeperId);
    if (used >= limit) throw NotificationError.tooManyRequests(dailyLimitMessage(limit));

    return tx.notificationSend.create({
      data: { ...send, status: "PENDING" },
      select: { id: true },
    });
  });
}
