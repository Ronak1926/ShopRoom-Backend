/**
 * services/notificationScheduler.service.ts — Worker that fires scheduled sends.
 *
 * Safe to run on every API instance:
 *   - Due schedules are claimed with UPDATE … FOR UPDATE SKIP LOCKED, so two
 *     instances never take the same row, and a claim expires on its own if the
 *     instance dies mid-run.
 *   - Each occurrence is stamped on its NotificationSend as
 *     (scheduleId, scheduledFor), which is unique — a retry after a crash can
 *     never deliver the same occurrence twice.
 *   - A run that is more than MISSED_GRACE_MS late is recorded as missed
 *     instead of firing a stale promo, and the series skips ahead.
 */

import { Prisma } from "../generated/client.js";
import { prisma } from "../database/prisma.js";
import { NotificationError } from "../utils/notificationError.js";
import { mapWithConcurrency } from "../utils/concurrency.js";
import { nextRunAfter } from "../utils/scheduleRecurrence.js";
import { kindFromLegs, usesRadius } from "./notificationAudience.service.js";
import { dispatchSend } from "./notificationDispatch.service.js";
import { isPlanActive } from "./billing.service.js";
import { getSendRules } from "./notificationPreferences.service.js";
import { blockedBy, type BlockReason } from "../utils/quietHours.js";
import { specFromSchedule } from "./notificationSchedule.service.js";
import { reserveSend, type NewSend } from "./notificationUsage.service.js";
import { logger } from "../lib/logger.js";
import { notificationSends, schedulerRuns } from "../lib/metrics.js";
import { withNewRequestId } from "../lib/requestContext.js";

const POLL_INTERVAL_MS = 30_000;
const CLAIM_BATCH = 20;
const CLAIM_LOCK_MS = 10 * 60_000;
const MISSED_GRACE_MS = 60 * 60_000;
const RUN_CONCURRENCY = 3;
/** A send still PENDING after this long never finished (the process died mid-send). */
const STALE_PENDING_MS = 15 * 60_000;
/** Caps how many back-to-back batches one tick may drain. */
const MAX_BATCHES_PER_TICK = 50;

const scheduleSelect = {
  id: true,
  shopkeeperId: true,
  roomId: true,
  designVersionId: true,
  message: true,
  includeMembers: true,
  includeNearby: true,
  radiusKm: true,
  includeFutureMembers: true,
  deliverySpeed: true,
  createdAt: true,
  status: true,
  nextRunAt: true,
  firstRunAt: true,
  timeZone: true,
  recurrence: true,
  repeatEvery: true,
  weekdays: true,
  endMode: true,
  endDate: true,
  endAfter: true,
  shopkeeper: { select: { planType: true, planExpiresAt: true } },
} as const;

async function claimDueSchedules(now: Date): Promise<string[]> {
  const claimedUntil = new Date(now.getTime() + CLAIM_LOCK_MS);
  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    UPDATE "NotificationSchedule"
    SET "lockedUntil" = ${claimedUntil}
    WHERE "id" IN (
      SELECT "id" FROM "NotificationSchedule"
      WHERE "status" = 'ACTIVE'
        AND "nextRunAt" <= ${now}
        AND ("lockedUntil" IS NULL OR "lockedUntil" < ${now})
      ORDER BY "nextRunAt" ASC
      LIMIT ${CLAIM_BATCH}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id"
  `);
  return rows.map((r) => r.id);
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

async function recordFailedSend(send: NewSend, failureReason: string): Promise<void> {
  try {
    await prisma.notificationSend.create({ data: { ...send, status: "FAILED", failureReason } });
  } catch (err) {
    // The occurrence was already recorded by an earlier attempt.
    if (!isUniqueViolation(err)) throw err;
  }
}

async function deliver(sendId: string, speed: "STANDARD" | "PRIORITY", joinedBefore: Date | undefined, ttlHours: number) {
  try {
    await dispatchSend(sendId, { deliverySpeed: speed, membersJoinedBefore: joinedBefore, ttlHours });
  } catch (err) {
    logger.error("Scheduled dispatch failed", err);
    notificationSends.inc({ status: "FAILED" });
    await prisma.notificationSend.update({
      where: { id: sendId },
      data: { status: "FAILED", failureReason: "DISPATCH_ERROR" },
    });
  }
}

async function runSchedule(scheduleId: string): Promise<void> {
  const schedule = await prisma.notificationSchedule.findUnique({
    where: { id: scheduleId },
    select: scheduleSelect,
  });
  if (!schedule || schedule.status !== "ACTIVE" || !schedule.nextRunAt) {
    await prisma.notificationSchedule.updateMany({
      where: { id: scheduleId },
      data: { lockedUntil: null },
    });
    return;
  }

  const occurrence = schedule.nextRunAt;
  const now = new Date();
  const rules = await getSendRules(schedule.shopkeeperId);
  let blocked: BlockReason | null = null;
  const missed = now.getTime() - occurrence.getTime() > MISSED_GRACE_MS;
  const kind = kindFromLegs(schedule.includeMembers, schedule.includeNearby);

  const send: NewSend = {
    shopkeeperId: schedule.shopkeeperId,
    roomId: schedule.roomId,
    designVersionId: schedule.designVersionId,
    audience: kind,
    radiusKm: usesRadius(kind) ? schedule.radiusKm : null,
    message: schedule.message,
    scheduleId: schedule.id,
    scheduledFor: occurrence,
  };

  if (missed) {
    schedulerRuns.inc({ result: "missed" });
    await recordFailedSend(send, "MISSED_WINDOW");
  } else if (!isPlanActive(schedule.shopkeeper.planExpiresAt, now)) {
    // The series carries on; its occurrences resume sending once the plan is renewed.
    schedulerRuns.inc({ result: "plan_expired" });
    await recordFailedSend(send, "PLAN_EXPIRED");
  } else if ((blocked = blockedBy(rules, occurrence, schedule.timeZone))) {
    // Rules can change after a schedule was made (or a recurrence can land on a weekend): skip, don't send.
    schedulerRuns.inc({ result: blocked === "QUIET_HOURS" ? "quiet_hours" : "weekend_blocked" });
    await recordFailedSend(send, blocked === "QUIET_HOURS" ? "QUIET_HOURS" : "WEEKEND_BLOCKED");
  } else {
    let sendId: string | null = null;
    try {
      sendId = (await reserveSend(send, schedule.shopkeeper.planType)).id;
    } catch (err) {
      if (err instanceof NotificationError && err.status === 429) {
        schedulerRuns.inc({ result: "limit_reached" });
        await recordFailedSend(send, "DAILY_LIMIT_REACHED");
      } else if (!isUniqueViolation(err)) {
        // Unexpected: leave the claim to expire so the occurrence is retried
        // (and is recorded as missed if it stays broken past the grace window).
        throw err;
      }
    }
    if (sendId) {
      schedulerRuns.inc({ result: "sent" });
      await deliver(
        sendId,
        schedule.deliverySpeed,
        schedule.includeFutureMembers ? undefined : schedule.createdAt,
        rules.expiryHours,
      );
    }
  }

  const next = nextRunAfter(specFromSchedule(schedule), missed ? now : occurrence);
  await prisma.notificationSchedule.updateMany({
    where: { id: schedule.id, status: "ACTIVE" },
    data: {
      lastRunAt: now,
      runCount: { increment: 1 },
      nextRunAt: next,
      status: next ? "ACTIVE" : "COMPLETED",
    },
  });
  // Also releases the claim when the shopkeeper paused or cancelled mid-run.
  await prisma.notificationSchedule.updateMany({
    where: { id: schedule.id, lockedUntil: { not: null } },
    data: { lockedUntil: null },
  });
}

/**
 * Marks sends that never finished as FAILED. PENDING counts against the daily
 * limit, so without this a crash mid-send would quietly burn the shop's allowance.
 */
export async function failStalePendingSends(now = new Date()): Promise<number> {
  const result = await prisma.notificationSend.updateMany({
    where: { status: "PENDING", createdAt: { lt: new Date(now.getTime() - STALE_PENDING_MS) } },
    data: { status: "FAILED", failureReason: "STALE_PENDING" },
  });
  return result.count;
}

/** Runs every schedule that is due at `now`; returns how many were claimed. */
export async function runDueSchedules(now = new Date()): Promise<number> {
  const ids = await claimDueSchedules(now);
  await mapWithConcurrency(ids, RUN_CONCURRENCY, (id) =>
    // Each occurrence gets its own correlation id so its logs can be followed end to end.
    withNewRequestId("job-schedule", () =>
      runSchedule(id).catch((err) => {
        logger.error("Schedule run failed", err, { scheduleId: id });
      }),
    ),
  );
  return ids.length;
}

let timer: NodeJS.Timeout | null = null;
let ticking = false;

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  await withNewRequestId("job-tick", async () => {
    try {
      const staleSends = await failStalePendingSends();
      if (staleSends > 0) logger.warn("Failed sends that never finished", { count: staleSends });
      for (let batch = 0; batch < MAX_BATCHES_PER_TICK; batch += 1) {
        if ((await runDueSchedules()) < CLAIM_BATCH) break;
      }
    } catch (err) {
      logger.error("Scheduler tick failed", err);
    } finally {
      ticking = false;
    }
  });
}

export function startNotificationScheduler(): void {
  if (timer) return;
  timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
  timer.unref();
  void tick();
}

export function stopNotificationScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
