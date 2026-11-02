/**
 * services/notificationAnalytics.service.ts — The numbers behind the dashboard
 * and the History page, measured from real sends and device receipts.
 *
 * Definitions, so the figures mean what they say:
 *   sent       devices the push service accepted (NotificationSend.successCount)
 *   delivered  devices that confirmed arrival (the app or service worker reported it)
 *   opened     devices where the notification was opened
 *   clicked    devices where a banner button was clicked
 * Rates: delivery = delivered / sent; open and click = opened or clicked / delivered.
 * A "day" is a calendar day in APP_TIMEZONE; the previous period of equal length is
 * the baseline for each change figure.
 */

import { Prisma } from "../generated/client.js";
import { prisma } from "../database/prisma.js";
import { addDays, getZonedParts, toIsoDate, zonedTimeToUtc } from "../utils/zonedTime.js";
import { appTimeZone } from "./notificationUsage.service.js";

export const MAX_ANALYTICS_DAYS = 90;

export interface Counts {
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
}

export interface DayPoint extends Counts {
  /** YYYY-MM-DD in the app's time zone. */
  date: string;
}

export interface AnalyticsView {
  days: number;
  timeZone: string;
  sends: number;
  totals: Counts;
  rates: { delivery: number; open: number; click: number };
  /** Percentage change against the previous period of the same length. */
  deltas: Counts;
  series: DayPoint[];
  topDesigns: { designId: string; name: string; sends: number; opened: number; delivered: number; openRate: number; clickRate: number }[];
  insights: { membersTotal: number; activeMembers: number; returningMembers: number; engagementScore: number };
}

const ZERO: Counts = { sent: 0, delivered: 0, opened: 0, clicked: 0 };
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);
const change = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : 0);

interface DayRow extends Counts {
  day: string;
  sends: number;
}

function sum(points: Counts[]): Counts {
  return points.reduce<Counts>(
    (t, p) => ({ sent: t.sent + p.sent, delivered: t.delivered + p.delivered, opened: t.opened + p.opened, clicked: t.clicked + p.clicked }),
    { ...ZERO },
  );
}

export async function getAnalytics(shopkeeperId: string, days: number, now = new Date()): Promise<AnalyticsView> {
  const timeZone = appTimeZone();

  // The local calendar days of the previous period followed by the current one.
  const today = getZonedParts(now, timeZone);
  const dates: string[] = [];
  for (let i = days * 2 - 1; i >= 0; i -= 1) dates.push(toIsoDate(addDays({ year: today.year, month: today.month, day: today.day }, -i)));
  const currentDates = new Set(dates.slice(days));

  // Local midnights as instants, compared as epoch seconds so the result never depends on a session time zone.
  const midnightEpoch = (iso: string) => {
    const [year, month, day] = iso.split("-").map(Number);
    return Math.floor(zonedTimeToUtc({ year, month, day, hour: 0, minute: 0 }, timeZone).getTime() / 1000);
  };
  const sinceEpoch = midnightEpoch(dates[0]);
  const currentSinceEpoch = midnightEpoch(dates[days]);
  const localDay = Prisma.sql`date_trunc('day', ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone})`;

  const [rows, topRows, room] = await Promise.all([
    prisma.$queryRaw<DayRow[]>(Prisma.sql`
      SELECT to_char(${localDay}, 'YYYY-MM-DD') AS "day",
             COUNT(*)::int AS "sends",
             COALESCE(SUM("successCount"), 0)::int AS "sent",
             COALESCE(SUM("deliveredCount"), 0)::int AS "delivered",
             COALESCE(SUM("openedCount"), 0)::int AS "opened",
             COALESCE(SUM("clickedCount"), 0)::int AS "clicked"
      FROM "NotificationSend"
      WHERE "shopkeeperId" = ${shopkeeperId} AND "status" <> 'PENDING'
        AND ("createdAt" AT TIME ZONE 'UTC') >= to_timestamp(${sinceEpoch})
      GROUP BY 1`),
    prisma.$queryRaw<{ designId: string; name: string; sends: number; delivered: number; opened: number; clicked: number }[]>(Prisma.sql`
      SELECT d."id" AS "designId", d."name" AS "name", COUNT(*)::int AS "sends",
             COALESCE(SUM(s."deliveredCount"), 0)::int AS "delivered", COALESCE(SUM(s."openedCount"), 0)::int AS "opened",
             COALESCE(SUM(s."clickedCount"), 0)::int AS "clicked"
      FROM "NotificationSend" s
      JOIN "NotificationDesignVersion" v ON v."id" = s."designVersionId"
      JOIN "NotificationDesign" d ON d."id" = v."designId"
      WHERE s."shopkeeperId" = ${shopkeeperId} AND s."status" = 'SENT'
        AND (s."createdAt" AT TIME ZONE 'UTC') >= to_timestamp(${currentSinceEpoch})
      GROUP BY d."id", d."name"
      ORDER BY COALESCE(SUM(s."openedCount"), 0)::float / GREATEST(COALESCE(SUM(s."deliveredCount"), 0), 1) DESC, COUNT(*) DESC
      LIMIT 3`),
    prisma.room.findFirst({ where: { shop: { ownerId: shopkeeperId } }, select: { id: true, membersCount: true } }),
  ]);

  const byDay = new Map(rows.map((r) => [r.day, r]));
  const series: DayPoint[] = dates.map((date) => {
    const r = byDay.get(date);
    return { date, sent: r?.sent ?? 0, delivered: r?.delivered ?? 0, opened: r?.opened ?? 0, clicked: r?.clicked ?? 0 };
  });
  const current = series.filter((p) => currentDates.has(p.date));
  const previous = series.filter((p) => !currentDates.has(p.date));
  const totals = sum(current);
  const before = sum(previous);
  const sends = rows.filter((r) => currentDates.has(r.day)).reduce((n, r) => n + r.sends, 0);

  const membersTotal = room?.membersCount ?? 0;
  let activeMembers = 0;
  let returningMembers = 0;
  if (room) {
    const [engaged] = await prisma.$queryRaw<{ active: number; returning: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS "active", COUNT(*) FILTER (WHERE "opens" >= 2)::int AS "returning"
      FROM (
        SELECT r."customerId", COUNT(DISTINCT r."sendId") AS "opens"
        FROM "NotificationSendRecipient" r
        JOIN "NotificationSend" s ON s."id" = r."sendId"
        WHERE s."shopkeeperId" = ${shopkeeperId} AND r."openedAt" IS NOT NULL
          AND (r."openedAt" AT TIME ZONE 'UTC') >= to_timestamp(${currentSinceEpoch})
        GROUP BY r."customerId"
      ) per_member`);
    activeMembers = engaged?.active ?? 0;
    returningMembers = engaged?.returning ?? 0;
  }

  return {
    days,
    timeZone,
    sends,
    totals,
    rates: { delivery: pct(totals.delivered, totals.sent), open: pct(totals.opened, totals.delivered), click: pct(totals.clicked, totals.delivered) },
    deltas: {
      sent: change(totals.sent, before.sent),
      delivered: change(totals.delivered, before.delivered),
      opened: change(totals.opened, before.opened),
      clicked: change(totals.clicked, before.clicked),
    },
    series: current,
    topDesigns: topRows.map((r) => ({
      designId: r.designId,
      name: r.name,
      sends: r.sends,
      opened: r.opened,
      delivered: r.delivered,
      openRate: pct(r.opened, r.delivered),
      clickRate: pct(r.clicked, r.delivered),
    })),
    insights: {
      membersTotal,
      activeMembers,
      returningMembers,
      engagementScore: membersTotal > 0 ? Math.min(100, Math.round((activeMembers / membersTotal) * 100)) : 0,
    },
  };
}
