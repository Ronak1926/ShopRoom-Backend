/**
 * services/notificationDispatch.service.ts — Delivers one NotificationSend to
 * its audience as FCM pushes and records what happened to every device.
 *
 * Shared by the "Send now" endpoint and the scheduled-send worker, so both
 * paths deliver identical payloads and write identical analytics rows.
 */

import { randomUUID } from "node:crypto";
import type { Message } from "firebase-admin/messaging";
import { prisma } from "../database/prisma.js";
import { firebaseMessaging } from "../lib/firebaseAdmin.js";
import { NotificationError } from "../utils/notificationError.js";
import { chunk, mapWithConcurrency, retryOnConflict } from "../utils/concurrency.js";
import { isAllowedImageUrl } from "../utils/safeUrl.js";
import type { CompositionNode } from "../schemas/notification.schema.js";
import { validateDesign } from "./notificationValidation.service.js";
import { resolveAudienceDevices, usesRadius } from "./notificationAudience.service.js";
import { logger } from "../lib/logger.js";
import { fcmTokensInvalidated, notificationDevices, notificationSends } from "../lib/metrics.js";
import { recordSendResult } from "./alerting.service.js";

const FCM_BATCH_SIZE = 500;
const FCM_CONCURRENCY = 4;
const DB_BATCH_SIZE = 5_000;
const DB_CONCURRENCY = 4;
/** A promo that arrives a day late is worse than one that never arrives. */
const PUSH_TTL_SECONDS = 24 * 60 * 60;

const INVALID_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

export type DeliverySpeedValue = "STANDARD" | "PRIORITY";

export interface DispatchOptions {
  /** Leaves out members who joined after this instant (schedules that exclude future members). */
  membersJoinedBefore?: Date;
  deliverySpeed?: DeliverySpeedValue;
}

export interface DispatchResult {
  recipients: number;
  successCount: number;
  failureCount: number;
}

interface PlannedRecipient {
  id: string;
  deviceId: string;
  customerId: string;
  fcmToken: string;
  receiptToken: string;
}

interface DeviceOutcome {
  recipientId: string;
  deviceId: string;
  ok: boolean;
  errorCode?: string;
}

/**
 * The first literal/uploaded image in the design tree (depth-first), used as
 * the native notification's large `image`. Dynamic product-image bindings are
 * skipped: only a real, directly-hosted URL qualifies.
 */
function findHeroImageUrl(elements: CompositionNode[]): string | undefined {
  for (const node of elements) {
    // Re-checked here as well as at save time: pinned versions can predate the host allow-list.
    if (node.asset?.type === "IMAGE" && node.asset.url && isAllowedImageUrl(node.asset.url)) {
      return node.asset.url;
    }
    if (node.children?.length) {
      const found = findHeroImageUrl(node.children);
      if (found) return found;
    }
  }
  return undefined;
}

function buildMessage(
  recipient: PlannedRecipient,
  base: Record<string, string>,
  speed: DeliverySpeedValue,
): Message {
  const priority = speed === "PRIORITY" ? "high" : "normal";
  // Data-only on purpose: with a top-level `notification` field Firebase's own
  // service-worker SDK shows the notification itself before our handler runs,
  // bypassing the hero image and risking a duplicate.
  return {
    token: recipient.fcmToken,
    data: { ...base, rt: recipient.receiptToken },
    android: { priority, ttl: PUSH_TTL_SECONDS * 1000 },
    webpush: { headers: { TTL: String(PUSH_TTL_SECONDS), Urgency: priority } },
  };
}

async function sendBatch(
  batch: PlannedRecipient[],
  base: Record<string, string>,
  speed: DeliverySpeedValue,
): Promise<DeviceOutcome[]> {
  try {
    const response = await firebaseMessaging.sendEach(
      batch.map((r) => buildMessage(r, base, speed)),
    );
    return response.responses.map((r, i) => ({
      recipientId: batch[i].id,
      deviceId: batch[i].deviceId,
      ok: r.success,
      errorCode: r.success ? undefined : (r.error?.code ?? "messaging/unknown-error"),
    }));
  } catch (err) {
    logger.error("FCM batch failed", err);
    return batch.map((r) => ({
      recipientId: r.id,
      deviceId: r.deviceId,
      ok: false,
      errorCode: "messaging/batch-failed",
    }));
  }
}

async function persistOutcomes(outcomes: DeviceOutcome[]): Promise<void> {
  const succeeded = outcomes.filter((o) => o.ok).map((o) => o.recipientId);
  const failedByCode = new Map<string, string[]>();
  for (const o of outcomes) {
    if (o.ok) continue;
    const code = o.errorCode ?? "messaging/unknown-error";
    failedByCode.set(code, [...(failedByCode.get(code) ?? []), o.recipientId]);
  }

  const statusWrites: Array<() => Promise<unknown>> = [
    ...chunk(succeeded, DB_BATCH_SIZE).map(
      (ids) => () =>
        prisma.notificationSendRecipient.updateMany({
          where: { id: { in: ids } },
          data: { status: "SENT" },
        }),
    ),
    ...Array.from(failedByCode).flatMap(([errorCode, ids]) =>
      chunk(ids, DB_BATCH_SIZE).map(
        (batch) => () =>
          prisma.notificationSendRecipient.updateMany({
            where: { id: { in: batch } },
            data: { status: "FAILED", errorCode },
          }),
      ),
    ),
  ];

  // Tokens FCM says are dead are removed so they are never targeted again.
  const deadDeviceIds = outcomes
    .filter((o) => !o.ok && o.errorCode && INVALID_TOKEN_CODES.has(o.errorCode))
    .map((o) => o.deviceId);
  const deviceWrites = chunk(deadDeviceIds, DB_BATCH_SIZE).map(
    (ids) => () => prisma.customerDevice.deleteMany({ where: { id: { in: ids } } }),
  );

  // Two phases, never interleaved. Deleting a device also rewrites its recipient
  // rows (the foreign key sets deviceId to NULL), the same rows the status updates
  // touch; running both at once takes row locks in opposite orders and deadlocks
  // on large sends. Conflicts that still occur are retried.
  await mapWithConcurrency(statusWrites, DB_CONCURRENCY, (write) => retryOnConflict(write));
  await mapWithConcurrency(deviceWrites, DB_CONCURRENCY, (write) => retryOnConflict(write));
  if (deadDeviceIds.length > 0) fcmTokensInvalidated.inc({}, deadDeviceIds.length);
}

async function finishSend(
  sendId: string,
  data: {
    status: "SENT" | "FAILED";
    failureReason?: string;
    recipientCount: number;
    successCount?: number;
    failureCount?: number;
  },
): Promise<void> {
  await prisma.notificationSend.update({
    where: { id: sendId },
    data: { ...data, ...(data.status === "SENT" ? { sentAt: new Date() } : {}) },
  });
  notificationSends.inc({ status: data.status });
}

export async function dispatchSend(
  sendId: string,
  options: DispatchOptions = {},
): Promise<DispatchResult> {
  const send = await prisma.notificationSend.findUnique({
    where: { id: sendId },
    select: {
      roomId: true,
      audience: true,
      radiusKm: true,
      message: true,
      designVersion: { select: { designJson: true } },
      room: {
        select: { shop: { select: { shopName: true, latitude: true, longitude: true } } },
      },
    },
  });
  if (!send) throw NotificationError.notFound("Send not found");

  const empty: DispatchResult = { recipients: 0, successCount: 0, failureCount: 0 };
  const shop = send.room.shop;

  if (
    usesRadius(send.audience) &&
    (shop.latitude === null || shop.longitude === null || !send.radiusKm)
  ) {
    await finishSend(sendId, {
      status: "FAILED",
      failureReason: "SHOP_LOCATION_MISSING",
      recipientCount: 0,
    });
    return empty;
  }

  const devices = await resolveAudienceDevices({
    roomId: send.roomId,
    kind: send.audience,
    radiusKm: send.radiusKm ?? undefined,
    center:
      shop.latitude !== null && shop.longitude !== null
        ? { latitude: shop.latitude, longitude: shop.longitude }
        : undefined,
    membersJoinedBefore: options.membersJoinedBefore,
  });

  if (devices.length === 0) {
    await finishSend(sendId, { status: "FAILED", failureReason: "NO_RECIPIENTS", recipientCount: 0 });
    return empty;
  }

  const planned: PlannedRecipient[] = devices.map((d) => ({
    id: randomUUID(),
    deviceId: d.deviceId,
    customerId: d.customerId,
    fcmToken: d.fcmToken,
    receiptToken: randomUUID(),
  }));

  // Rows exist before the push goes out so a crash mid-send leaves an auditable
  // QUEUED trail, and so every payload can carry its own receipt token.
  await mapWithConcurrency(chunk(planned, DB_BATCH_SIZE), DB_CONCURRENCY, (rows) =>
    prisma.notificationSendRecipient.createMany({
      data: rows.map((r) => ({
        id: r.id,
        sendId,
        customerId: r.customerId,
        deviceId: r.deviceId,
        receiptToken: r.receiptToken,
      })),
    }),
  );

  const design = validateDesign(send.designVersion.designJson);
  const heroImageUrl = design.valid ? findHeroImageUrl(design.data.elements) : undefined;
  const base: Record<string, string> = {
    type: "DESIGN_PUSH",
    sendId,
    roomId: send.roomId,
    title: shop.shopName,
    body: send.message?.trim() || "New update from your favourite shop",
  };
  if (heroImageUrl) base.imageUrl = heroImageUrl;

  const batches = await mapWithConcurrency(
    chunk(planned, FCM_BATCH_SIZE),
    FCM_CONCURRENCY,
    (batch) => sendBatch(batch, base, options.deliverySpeed ?? "STANDARD"),
  );
  const outcomes = batches.flat();
  await persistOutcomes(outcomes);

  const successCount = outcomes.filter((o) => o.ok).length;
  const failureCount = outcomes.length - successCount;
  notificationDevices.inc({ result: "success" }, successCount);
  notificationDevices.inc({ result: "failure" }, failureCount);
  recordSendResult(successCount, failureCount);
  await finishSend(sendId, {
    status: successCount > 0 ? "SENT" : "FAILED",
    failureReason: successCount > 0 ? undefined : "ALL_DELIVERIES_FAILED",
    recipientCount: planned.length,
    successCount,
    failureCount,
  });

  return { recipients: planned.length, successCount, failureCount };
}
