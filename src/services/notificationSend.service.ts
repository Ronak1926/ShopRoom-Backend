/**
 * services/notificationSend.service.ts — "Send now": pins the chosen design,
 * reserves a slot against the plan's daily limit, and dispatches to the
 * selected audience.
 */

import { prisma } from "../database/prisma.js";
import { NotificationError } from "../utils/notificationError.js";
import type { SendNotificationInput } from "../schemas/notificationSendRequest.schema.js";
import { pinDesignVersion, resolveDesignId } from "./notificationDesignPin.service.js";
import { assertPlanActive, assertShopHasLocation, loadSenderContext } from "./notificationSender.service.js";
import { getSendRules } from "./notificationPreferences.service.js";
import { assertUnderDailyLimit, reserveSend } from "./notificationUsage.service.js";
import { dispatchSend } from "./notificationDispatch.service.js";
import { usesRadius } from "./notificationAudience.service.js";
import { logger } from "../lib/logger.js";
import { notificationSends } from "../lib/metrics.js";

export interface SendNotificationResult {
  id: string;
  recipients: number;
}

export async function sendNotification(
  shopkeeperId: string,
  input: SendNotificationInput,
): Promise<SendNotificationResult> {
  const sender = await loadSenderContext(shopkeeperId);
  assertPlanActive(sender);
  const kind = input.audience.mode;
  if (usesRadius(kind)) assertShopHasLocation(sender);

  await assertUnderDailyLimit(shopkeeperId, sender.planType);
  const { expiryHours } = await getSendRules(shopkeeperId);

  const designId = await resolveDesignId(shopkeeperId, input.source, input.notificationId);
  const { designVersionId } = await pinDesignVersion(shopkeeperId, designId);

  const send = await reserveSend(
    {
      shopkeeperId,
      roomId: sender.roomId,
      designVersionId,
      audience: kind,
      radiusKm: usesRadius(kind) ? input.audience.radiusKm : null,
      message: input.message || null,
    },
    sender.planType,
  );

  try {
    const result = await dispatchSend(send.id, { ttlHours: expiryHours });
    return { id: send.id, recipients: result.recipients };
  } catch (err) {
    logger.error("Dispatch failed", err);
    notificationSends.inc({ status: "FAILED" });
    await prisma.notificationSend.update({
      where: { id: send.id },
      data: { status: "FAILED", failureReason: "DISPATCH_ERROR" },
    });
    throw NotificationError.badGateway("We couldn't reach the push service. Please try again.");
  }
}
