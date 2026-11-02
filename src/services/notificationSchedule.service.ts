/**
 * services/notificationSchedule.service.ts — Create, list, pause/resume and
 * cancel scheduled sends. The worker that fires them lives in
 * notificationScheduler.service.ts; the recurrence maths is in
 * utils/scheduleRecurrence.ts.
 */

import type { ScheduleStatus } from "../generated/client.js";
import { prisma } from "../database/prisma.js";
import { NotificationError } from "../utils/notificationError.js";
import { nextRunAfter, type RecurrenceSpec } from "../utils/scheduleRecurrence.js";
import type { CreateScheduleInput } from "../schemas/notificationScheduleRequest.schema.js";
import { pinDesignVersion, resolveDesignId } from "./notificationDesignPin.service.js";
import { assertPlanActive, assertShopHasLocation, loadSenderContext } from "./notificationSender.service.js";
import { getSendRules } from "./notificationPreferences.service.js";
import { BLOCK_MESSAGES, blockedBy } from "../utils/quietHours.js";

/** A shop can't queue an unbounded backlog for the worker. */
export const MAX_LIVE_SCHEDULES = 50;
const MAX_LEAD_DAYS = 366;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

export interface ScheduleView {
  id: string;
  status: "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELLED";
  nextRunAt: string | null;
  lastRunAt: string | null;
  runCount: number;
  message: string | null;
  recurrence: "ONCE" | "DAILY" | "WEEKLY" | "MONTHLY";
  repeatEvery: number;
  weekdays: number[];
  endMode: "NEVER" | "ON" | "AFTER";
  endDate: string | null;
  endAfter: number | null;
  deliverySpeed: "STANDARD" | "PRIORITY";
  timeZone: string;
  includeMembers: boolean;
  includeNearby: boolean;
  radiusKm: number;
  designName: string;
  designJson: unknown;
}

const scheduleSelect = {
  id: true,
  status: true,
  nextRunAt: true,
  lastRunAt: true,
  runCount: true,
  message: true,
  recurrence: true,
  repeatEvery: true,
  weekdays: true,
  endMode: true,
  endDate: true,
  endAfter: true,
  deliverySpeed: true,
  timeZone: true,
  includeMembers: true,
  includeNearby: true,
  radiusKm: true,
  designVersion: { select: { designJson: true, design: { select: { name: true } } } },
} as const;

type ScheduleRow = Awaited<ReturnType<typeof findOneRow>>;

function findOneRow(shopkeeperId: string, id: string) {
  return prisma.notificationSchedule.findFirst({
    where: { id, shopkeeperId },
    select: scheduleSelect,
  });
}

function toView(row: NonNullable<ScheduleRow>): ScheduleView {
  const { designVersion, nextRunAt, lastRunAt, ...rest } = row;
  return {
    ...rest,
    nextRunAt: nextRunAt?.toISOString() ?? null,
    lastRunAt: lastRunAt?.toISOString() ?? null,
    designName: designVersion.design.name,
    designJson: designVersion.designJson,
  };
}

export function specFromSchedule(row: {
  firstRunAt: Date;
  timeZone: string;
  recurrence: RecurrenceSpec["recurrence"];
  repeatEvery: number;
  weekdays: number[];
  endMode: RecurrenceSpec["endMode"];
  endDate: string | null;
  endAfter: number | null;
}): RecurrenceSpec {
  return {
    firstRunAt: row.firstRunAt,
    timeZone: row.timeZone,
    recurrence: row.recurrence,
    repeatEvery: row.repeatEvery,
    weekdays: row.weekdays,
    endMode: row.endMode,
    endDate: row.endDate,
    endAfter: row.endAfter,
  };
}

export async function createSchedule(
  shopkeeperId: string,
  input: CreateScheduleInput,
): Promise<{ id: string; nextRunAt: string }> {
  const { audience, schedule } = input;
  const sender = await loadSenderContext(shopkeeperId);
  assertPlanActive(sender);
  if (audience.includeNearby) assertShopHasLocation(sender);

  // Occurrences live on the wall clock at minute precision.
  const requested = new Date(schedule.sendAt).getTime();
  const firstRunAt = new Date(Math.floor(requested / MINUTE_MS) * MINUTE_MS);
  const now = new Date();
  if (firstRunAt.getTime() > now.getTime() + MAX_LEAD_DAYS * DAY_MS) {
    throw NotificationError.badRequest("Schedule within the next year.");
  }

  const spec: RecurrenceSpec = {
    firstRunAt,
    timeZone: schedule.timeZone,
    recurrence: schedule.recurrence,
    repeatEvery: schedule.repeatEvery,
    weekdays: schedule.weekdays,
    endMode: schedule.endMode,
    endDate: schedule.endDate,
    endAfter: schedule.endAfter,
  };
  const nextRunAt = nextRunAfter(spec, now);
  if (!nextRunAt) throw NotificationError.badRequest("Pick a time in the future.");

  // Quiet hours and weekend sending are the shopkeeper's own rules; refuse a first run that already breaks them.
  const blocked = blockedBy(await getSendRules(shopkeeperId), nextRunAt, schedule.timeZone);
  if (blocked) throw NotificationError.badRequest(BLOCK_MESSAGES[blocked]);

  const live = await prisma.notificationSchedule.count({
    where: { shopkeeperId, status: { in: ["ACTIVE", "PAUSED"] } },
  });
  if (live >= MAX_LIVE_SCHEDULES) {
    throw NotificationError.tooManyRequests(
      `You can keep up to ${MAX_LIVE_SCHEDULES} schedules at a time. Cancel one to add another.`,
    );
  }

  const designId = await resolveDesignId(shopkeeperId, input.source, input.notificationId);
  const { designVersionId } = await pinDesignVersion(shopkeeperId, designId);

  const created = await prisma.notificationSchedule.create({
    data: {
      shopkeeperId,
      roomId: sender.roomId,
      designVersionId,
      message: input.message || null,
      includeMembers: audience.includeMembers,
      includeNearby: audience.includeNearby,
      radiusKm: audience.radiusKm,
      includeFutureMembers: audience.includeFutureMembers,
      timeZone: schedule.timeZone,
      firstRunAt,
      recurrence: schedule.recurrence,
      repeatEvery: schedule.repeatEvery,
      weekdays: Array.from(new Set(schedule.weekdays)).sort((a, b) => a - b),
      endMode: schedule.endMode,
      endDate: schedule.endMode === "ON" ? schedule.endDate : null,
      endAfter: schedule.endMode === "AFTER" ? schedule.endAfter : null,
      deliverySpeed: schedule.deliverySpeed,
      nextRunAt,
    },
    select: { id: true },
  });

  return { id: created.id, nextRunAt: nextRunAt.toISOString() };
}

export async function listSchedules(
  shopkeeperId: string,
  query: { state: "upcoming" | "completed"; page: number; limit: number },
): Promise<{ items: ScheduleView[]; total: number; page: number; limit: number }> {
  const upcoming = query.state === "upcoming";
  const statuses: ScheduleStatus[] = upcoming ? ["ACTIVE", "PAUSED"] : ["COMPLETED", "CANCELLED"];
  const where = { shopkeeperId, status: { in: statuses } };
  const [rows, total] = await Promise.all([
    prisma.notificationSchedule.findMany({
      where,
      select: scheduleSelect,
      orderBy: upcoming ? { nextRunAt: "asc" } : { updatedAt: "desc" },
      take: query.limit,
      skip: (query.page - 1) * query.limit,
    }),
    prisma.notificationSchedule.count({ where }),
  ]);
  return { items: rows.map(toView), total, page: query.page, limit: query.limit };
}

export async function setScheduleStatus(
  shopkeeperId: string,
  id: string,
  status: "ACTIVE" | "PAUSED",
): Promise<ScheduleView> {
  const current = await prisma.notificationSchedule.findFirst({
    where: { id, shopkeeperId, status: { in: ["ACTIVE", "PAUSED"] } },
    select: {
      firstRunAt: true,
      timeZone: true,
      recurrence: true,
      repeatEvery: true,
      weekdays: true,
      endMode: true,
      endDate: true,
      endAfter: true,
    },
  });
  if (!current) throw NotificationError.notFound("Schedule not found");

  // Resuming recomputes from now, so a pause that outlasted occurrences never
  // replays them as a burst.
  const resumedNext = status === "ACTIVE" ? nextRunAfter(specFromSchedule(current), new Date()) : null;
  const finishedWhilePaused = status === "ACTIVE" && resumedNext === null;

  await prisma.notificationSchedule.updateMany({
    where: { id, shopkeeperId, status: { in: ["ACTIVE", "PAUSED"] } },
    data: finishedWhilePaused
      ? { status: "COMPLETED", nextRunAt: null, lockedUntil: null }
      : status === "ACTIVE"
        ? { status: "ACTIVE", nextRunAt: resumedNext }
        : { status: "PAUSED" },
  });

  const row = await findOneRow(shopkeeperId, id);
  if (!row) throw NotificationError.notFound("Schedule not found");
  return toView(row);
}

export async function cancelSchedule(shopkeeperId: string, id: string): Promise<void> {
  const result = await prisma.notificationSchedule.updateMany({
    where: { id, shopkeeperId, status: { in: ["ACTIVE", "PAUSED"] } },
    data: { status: "CANCELLED", nextRunAt: null },
  });
  if (result.count === 0) throw NotificationError.notFound("Schedule not found");
}
