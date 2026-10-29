/**
 * services/notificationSend.service.ts — Dispatches a NotificationDesign to a
 * room's members as a real FCM push. Pins to an immutable
 * NotificationDesignVersion so later edits to the live design never change
 * what was actually delivered.
 */

import { prisma } from "../database/prisma.js";
import { NotificationError } from "../utils/notificationError.js";
import { toJsonInput } from "../utils/notificationDesign.js";
import { validateDesign } from "./notificationValidation.service.js";
import { useTemplate } from "./notificationTemplate.service.js";
import { firebaseMessaging } from "../lib/firebaseAdmin.js";
import type { SendNotificationInput } from "../schemas/notificationSendRequest.schema.js";
import type { CompositionNode, NotificationDesign } from "../schemas/notification.schema.js";

const FCM_BATCH_SIZE = 500;
const INVALID_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

export interface SendNotificationResult {
  id: string;
  recipients: number;
}

/** Resolves source: TEMPLATE clones into an owned design first; DESIGN is used as-is. */
async function resolveDesignId(
  shopkeeperId: string,
  source: "DESIGN" | "TEMPLATE",
  notificationId: string,
): Promise<string> {
  if (source === "TEMPLATE") {
    const design = await useTemplate(shopkeeperId, notificationId);
    return design.id;
  }
  return notificationId;
}

/** Snapshots the design's current state as a fresh immutable version and returns its id + content. */
async function pinDesignVersion(
  shopkeeperId: string,
  designId: string,
): Promise<{ designVersionId: string; design: NotificationDesign }> {
  return prisma.$transaction(async (tx) => {
    const design = await tx.notificationDesign.findFirst({
      where: { id: designId, shopkeeperId },
      select: { designJson: true, version: true },
    });
    if (!design) throw NotificationError.notFound("Design not found");

    const validated = validateDesign(design.designJson);
    if (!validated.valid) {
      throw NotificationError.badRequest("Stored design is invalid");
    }

    const nextVersion = design.version + 1;
    const versionRow = await tx.notificationDesignVersion.create({
      data: {
        designId,
        version: nextVersion,
        designJson: toJsonInput(validated.data),
        createdBy: shopkeeperId,
      },
      select: { id: true },
    });
    await tx.notificationDesign.update({
      where: { id: designId },
      data: { version: nextVersion },
    });

    return { designVersionId: versionRow.id, design: validated.data };
  });
}

/**
 * Finds a hero image for the native-notification "image" field — the first
 * literal/uploaded image asset in the design tree (depth-first). Dynamic
 * product-image bindings are skipped: there's no Product model in this
 * codebase yet to resolve them against at send time, so only a real,
 * directly-hosted URL (Cloudinary, stock photo, etc.) qualifies. Returns
 * undefined rather than guessing when the design has no such image.
 */
function findHeroImageUrl(elements: CompositionNode[]): string | undefined {
  for (const node of elements) {
    if (node.asset?.type === "IMAGE" && node.asset.url) {
      return node.asset.url;
    }
    if (node.children?.length) {
      const found = findHeroImageUrl(node.children);
      if (found) return found;
    }
  }
  return undefined;
}

export async function sendNotification(
  shopkeeperId: string,
  input: SendNotificationInput,
): Promise<SendNotificationResult> {
  const designId = await resolveDesignId(shopkeeperId, input.source, input.notificationId);
  const { designVersionId, design } = await pinDesignVersion(shopkeeperId, designId);
  const heroImageUrl = findHeroImageUrl(design.elements);

  const shop = await prisma.shop.findUnique({
    where: { ownerId: shopkeeperId },
    select: { shopName: true, room: { select: { id: true } } },
  });
  if (!shop?.room) throw NotificationError.badRequest("No room found for this shop");
  const roomId = shop.room.id;

  const send = await prisma.notificationSend.create({
    data: {
      shopkeeperId,
      roomId,
      designVersionId,
      audience: "ROOM_MEMBERS",
      message: input.message || null,
      status: "PENDING",
    },
    select: { id: true },
  });

  // Fan-out runs outside any transaction — never hold a DB transaction open
  // across a network call to FCM.
  const memberships = await prisma.membership.findMany({
    where: { roomId, notificationsEnabled: true },
    select: { customer: { select: { devices: { select: { fcmToken: true } } } } },
  });
  const tokens = Array.from(
    new Set(memberships.flatMap((m) => m.customer.devices.map((d) => d.fcmToken))),
  );

  if (tokens.length === 0) {
    await prisma.notificationSend.update({
      where: { id: send.id },
      data: { status: "FAILED", recipientCount: 0 },
    });
    return { id: send.id, recipients: 0 };
  }

  const chunks: string[][] = [];
  for (let i = 0; i < tokens.length; i += FCM_BATCH_SIZE) {
    chunks.push(tokens.slice(i, i + FCM_BATCH_SIZE));
  }

  const title = shop.shopName;
  const body = input.message?.trim() || "New update from your favourite shop";

  // Data-only payload, deliberately with NO top-level `notification` field:
  // Firebase's own service-worker SDK auto-displays a notification itself
  // whenever a `notification` field is present (before our onBackgroundMessage
  // handler even runs), using only title/body/image — bypassing our custom
  // display logic and risking a duplicate notification. Going data-only hands
  // display entirely to our own service worker code, which is the only way to
  // reliably control the native notification's image/icon/click behaviour.
  const data: Record<string, string> = {
    type: "DESIGN_PUSH",
    sendId: send.id,
    roomId,
    title,
    body,
  };
  if (heroImageUrl) data.imageUrl = heroImageUrl;

  const batchResults = await Promise.all(
    chunks.map((chunk) => firebaseMessaging.sendEachForMulticast({ tokens: chunk, data })),
  );

  let successCount = 0;
  let failureCount = 0;
  const invalidTokens: string[] = [];
  batchResults.forEach((batch, batchIndex) => {
    const chunk = chunks[batchIndex];
    batch.responses.forEach((r, i) => {
      if (r.success) {
        successCount += 1;
      } else {
        failureCount += 1;
        if (r.error?.code && INVALID_TOKEN_CODES.has(r.error.code)) {
          invalidTokens.push(chunk[i]);
        }
      }
    });
  });

  if (invalidTokens.length > 0) {
    await prisma.customerDevice.deleteMany({ where: { fcmToken: { in: invalidTokens } } });
  }

  await prisma.notificationSend.update({
    where: { id: send.id },
    data: {
      status: "SENT",
      sentAt: new Date(),
      recipientCount: tokens.length,
      successCount,
      failureCount,
    },
  });

  return { id: send.id, recipients: tokens.length };
}
