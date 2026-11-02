/**
 * services/notificationHistory.service.ts — The shopkeeper's send history with
 * per-send delivery analytics. Counters are denormalised on NotificationSend,
 * so a page of history is one query.
 */

import { prisma } from "../database/prisma.js";
import type { Prisma } from "../generated/client.js";
import { escapeLike } from "../utils/like.js";

export interface SendHistoryItem {
  id: string;
  designId: string;
  createdAt: string;
  sentAt: string | null;
  status: "PENDING" | "SENT" | "FAILED";
  failureReason: string | null;
  audience: "ROOM_MEMBERS" | "NEARBY" | "MEMBERS_NEARBY" | "MEMBERS_AND_NEARBY";
  radiusKm: number | null;
  message: string | null;
  designName: string;
  scheduled: boolean;
  recipientCount: number;
  successCount: number;
  failureCount: number;
  deliveredCount: number;
  openedCount: number;
  clickedCount: number;
}

export const HISTORY_OUTCOMES = ["all", "delivered", "opened", "clicked", "failed"] as const;
export const HISTORY_SORTS = ["latest", "oldest", "opens", "clicks"] as const;

export interface HistoryQuery {
  page: number;
  limit: number;
  outcome?: (typeof HISTORY_OUTCOMES)[number];
  sort?: (typeof HISTORY_SORTS)[number];
  /** Matches the message or the design's name. */
  q?: string;
  /** Only sends from the last N days. */
  days?: number;
}

function whereFor(shopkeeperId: string, query: HistoryQuery): Prisma.NotificationSendWhereInput {
  const where: Prisma.NotificationSendWhereInput = { shopkeeperId };
  switch (query.outcome) {
    case "failed":
      where.status = "FAILED";
      break;
    case "delivered":
      where.status = "SENT";
      where.deliveredCount = { gt: 0 };
      break;
    case "opened":
      where.openedCount = { gt: 0 };
      break;
    case "clicked":
      where.clickedCount = { gt: 0 };
      break;
  }
  if (query.q) {
    const needle = escapeLike(query.q);
    where.OR = [
      { message: { contains: needle, mode: "insensitive" } },
      { designVersion: { design: { name: { contains: needle, mode: "insensitive" } } } },
    ];
  }
  if (query.days) where.createdAt = { gte: new Date(Date.now() - query.days * 86_400_000) };
  return where;
}

const ORDER: Record<(typeof HISTORY_SORTS)[number], Prisma.NotificationSendOrderByWithRelationInput[]> = {
  latest: [{ createdAt: "desc" }, { id: "desc" }],
  oldest: [{ createdAt: "asc" }, { id: "asc" }],
  opens: [{ openedCount: "desc" }, { createdAt: "desc" }],
  clicks: [{ clickedCount: "desc" }, { createdAt: "desc" }],
};

export async function listSends(
  shopkeeperId: string,
  query: HistoryQuery,
): Promise<{ items: SendHistoryItem[]; total: number; page: number; limit: number }> {
  const where = whereFor(shopkeeperId, query);
  const [rows, total] = await Promise.all([
    prisma.notificationSend.findMany({
      where,
      select: {
        id: true,
        createdAt: true,
        sentAt: true,
        status: true,
        failureReason: true,
        audience: true,
        radiusKm: true,
        message: true,
        scheduleId: true,
        recipientCount: true,
        successCount: true,
        failureCount: true,
        deliveredCount: true,
        openedCount: true,
        clickedCount: true,
        designVersion: { select: { design: { select: { id: true, name: true } } } },
      },
      orderBy: ORDER[query.sort ?? "latest"],
      take: query.limit,
      skip: (query.page - 1) * query.limit,
    }),
    prisma.notificationSend.count({ where }),
  ]);

  const items = rows.map(({ designVersion, scheduleId, createdAt, sentAt, ...rest }) => ({
    ...rest,
    createdAt: createdAt.toISOString(),
    sentAt: sentAt?.toISOString() ?? null,
    scheduled: scheduleId !== null,
    designId: designVersion.design.id,
    designName: designVersion.design.name,
  }));
  return { items, total, page: query.page, limit: query.limit };
}
