/**
 * services/notificationDesignPin.service.ts — Freezes the design a shopkeeper
 * picked into an immutable NotificationDesignVersion, so what is delivered
 * (now or on a later schedule run) is exactly what they selected even if the
 * live design is edited afterwards.
 */

import { prisma } from "../database/prisma.js";
import { NotificationError } from "../utils/notificationError.js";
import { toJsonInput } from "../utils/notificationDesign.js";
import { validateDesign } from "./notificationValidation.service.js";
import { useTemplate } from "./notificationTemplate.service.js";

/** Resolves source: TEMPLATE into an owned design first; DESIGN is used as-is. */
export async function resolveDesignId(
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

/** Snapshots the design's current state as a fresh immutable version and returns its id. */
export async function pinDesignVersion(
  shopkeeperId: string,
  designId: string,
): Promise<{ designVersionId: string }> {
  return prisma.$transaction(async (tx) => {
    const design = await tx.notificationDesign.findFirst({
      where: { id: designId, shopkeeperId },
      select: { designJson: true },
    });
    if (!design) throw NotificationError.notFound("Design not found");

    const validated = validateDesign(design.designJson);
    if (!validated.valid) throw NotificationError.badRequest("Stored design is invalid");

    // Bumping first takes the design row's lock, so two sends of the same
    // design at once get distinct version numbers instead of colliding on the
    // (designId, version) unique key.
    const bumped = await tx.notificationDesign.update({
      where: { id: designId },
      data: { version: { increment: 1 } },
      select: { version: true },
    });
    const versionRow = await tx.notificationDesignVersion.create({
      data: {
        designId,
        version: bumped.version,
        designJson: toJsonInput(validated.data),
        createdBy: shopkeeperId,
      },
      select: { id: true },
    });

    return { designVersionId: versionRow.id };
  });
}
