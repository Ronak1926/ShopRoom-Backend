/**
 * services/notificationReceipt.service.ts — Records what a device did with a
 * push: received it (DELIVERED), saw/opened it (OPENED), or tapped through
 * (CLICKED). Each event implies the ones before it.
 *
 * Idempotent and first-write-wins: replays and double taps change nothing, and
 * the send's denormalised counters only move when a timestamp is first set.
 */

import { prisma } from "../database/prisma.js";

export type ReceiptEvent = "DELIVERED" | "OPENED" | "CLICKED";

type Stage = {
  column: "deliveredAt" | "openedAt" | "clickedAt";
  counter: "deliveredCount" | "openedCount" | "clickedCount";
};

const DELIVERED: Stage = { column: "deliveredAt", counter: "deliveredCount" };
const OPENED: Stage = { column: "openedAt", counter: "openedCount" };
const CLICKED: Stage = { column: "clickedAt", counter: "clickedCount" };

const STAGES_BY_EVENT: Record<ReceiptEvent, Stage[]> = {
  DELIVERED: [DELIVERED],
  OPENED: [DELIVERED, OPENED],
  CLICKED: [DELIVERED, OPENED, CLICKED],
};

/**
 * Unknown tokens are ignored on purpose: the endpoint takes no login, so it
 * must not reveal which tokens exist.
 */
export async function recordReceipt(receiptToken: string, event: ReceiptEvent): Promise<void> {
  const recipient = await prisma.notificationSendRecipient.findUnique({
    where: { receiptToken },
    select: { id: true, sendId: true },
  });
  if (!recipient) return;

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    for (const stage of STAGES_BY_EVENT[event]) {
      const claimed = await tx.notificationSendRecipient.updateMany({
        where: { id: recipient.id, [stage.column]: null },
        data: { [stage.column]: now },
      });
      if (claimed.count === 1) {
        await tx.notificationSend.update({
          where: { id: recipient.sendId },
          data: { [stage.counter]: { increment: 1 } },
        });
      }
    }
  });
}
