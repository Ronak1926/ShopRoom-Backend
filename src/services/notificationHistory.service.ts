/**
 * services/notificationHistory.service.ts — The shopkeeper's send history with
 * per-send delivery analytics. Counters are denormalised on NotificationSend,
 * so a page of history is one query.
 */

import { prisma } from "../database/prisma.js";

export interface SendHistoryItem {
  id: string;
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

export async function listSends(
  shopkeeperId: string,
  query: { page: number; limit: number },
): Promise<{ items: SendHistoryItem[]; total: number; page: number; limit: number }> {
  const [rows, total] = await Promise.all([
    prisma.notificationSend.findMany({
      where: { shopkeeperId },
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
        designVersion: { select: { design: { select: { name: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: query.limit,
      skip: (query.page - 1) * query.limit,
    }),
    prisma.notificationSend.count({ where: { shopkeeperId } }),
  ]);

  const items = rows.map(({ designVersion, scheduleId, createdAt, sentAt, ...rest }) => ({
    ...rest,
    createdAt: createdAt.toISOString(),
    sentAt: sentAt?.toISOString() ?? null,
    scheduled: scheduleId !== null,
    designName: designVersion.design.name,
  }));
  return { items, total, page: query.page, limit: query.limit };
}
