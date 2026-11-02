/**
 * services/dataRetention.service.ts — Deletes data once it has outlived its
 * purpose. The periods below are the retention policy documented in
 * docs/security/PII_INVENTORY.md; change both together.
 */

import { prisma } from "../database/prisma.js";
import { logger } from "../lib/logger.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const RUN_INTERVAL_MS = DAY_MS;

export const RETENTION = {
  /** Email OTP rows are useless a day after they expire. */
  emailOtpGraceDays: 1,
  /** A customer's last reported position is erased if not refreshed (the app refreshes it every 30 minutes while open). */
  stalePositionDays: 30,
  /** Per-device delivery rows; the send keeps its aggregate counters. */
  deliveryRecordDays: 180,
  /** FCM itself retires tokens unused for 270 days. */
  inactiveDeviceDays: 270,
} as const;

export interface RetentionResult {
  rateLimitCounters: number;
  emailOtps: number;
  stalePositions: number;
  deliveryRecords: number;
  inactiveDevices: number;
}

export async function purgeExpiredData(now = new Date()): Promise<RetentionResult> {
  const ago = (days: number) => new Date(now.getTime() - days * DAY_MS);

  const [rateLimitCounters, emailOtps, stalePositions, deliveryRecords, inactiveDevices] = await Promise.all([
    // Windows are at most an hour long; an expired counter does nothing and is only clutter.
    prisma.$executeRaw`DELETE FROM "RateLimitCounter" WHERE "resetAt" < now() - interval '1 hour'`,
    prisma.emailOtp.deleteMany({ where: { expiresAt: { lt: ago(RETENTION.emailOtpGraceDays) } } }),
    prisma.customer.updateMany({
      where: {
        OR: [
          { locationUpdatedAt: { lt: ago(RETENTION.stalePositionDays) } },
          // Positions stored before the freshness column existed.
          { locationUpdatedAt: null, latitude: { not: null }, updatedAt: { lt: ago(RETENTION.stalePositionDays) } },
        ],
      },
      data: { latitude: null, longitude: null, locationUpdatedAt: null },
    }),
    prisma.notificationSendRecipient.deleteMany({ where: { createdAt: { lt: ago(RETENTION.deliveryRecordDays) } } }),
    prisma.customerDevice.deleteMany({ where: { lastSeenAt: { lt: ago(RETENTION.inactiveDeviceDays) } } }),
  ]);

  return {
    rateLimitCounters,
    emailOtps: emailOtps.count,
    stalePositions: stalePositions.count,
    deliveryRecords: deliveryRecords.count,
    inactiveDevices: inactiveDevices.count,
  };
}

let timer: NodeJS.Timeout | null = null;

async function runOnce(): Promise<void> {
  try {
    const result = await purgeExpiredData();
    const total = Object.values(result).reduce((sum, n) => sum + n, 0);
    if (total > 0) logger.info("Retention purge", { ...result });
  } catch (err) {
    logger.error("Retention purge failed", err);
  }
}

export function startDataRetention(): void {
  if (timer) return;
  timer = setInterval(() => void runOnce(), RUN_INTERVAL_MS);
  timer.unref();
  void runOnce();
}

export function stopDataRetention(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
