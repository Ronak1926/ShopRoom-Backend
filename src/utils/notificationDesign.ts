/**
 * utils/notificationDesign.ts — Pure helpers for constructing and re-stamping
 * NotificationDesign documents. No DB access, no side effects.
 */

import { Prisma } from "../generated/client.js";
import {
  SCHEMA_VERSION,
  type NotificationDesign,
  type NotificationType,
} from "../schemas/notification.schema.js";

type DesignSource = NotificationDesign["metadata"]["source"];

/** Cast a validated design into the shape Prisma accepts for a Json column. */
export function toJsonInput(design: NotificationDesign): Prisma.InputJsonValue {
  return design as unknown as Prisma.InputJsonValue;
}

interface BlankDesignParams {
  id: string;
  name: string;
  category: NotificationType;
  source?: DesignSource;
}

/** A fresh, empty design on a phone-sized canvas with a white background. */
export function buildBlankDesign({
  id,
  name,
  category,
  source = "CUSTOM",
}: BlankDesignParams): NotificationDesign {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    name,
    category,
    status: "DRAFT",
    designTokens: {
      colors: { primary: "#5B47D4", ink: "#0F172A", muted: "#55596E", onBrand: "#FFFFFF" },
      radius: { sm: 8, md: 14, lg: 20 },
    },
    canvas: {
      width: 360,
      height: 640,
      background: { type: "SOLID", color: "#FFFFFF" },
    },
    elements: [],
    metadata: { createdAt: now, updatedAt: now, source },
  };
}

/**
 * Re-roots an existing design document onto a new owned copy: fresh id/name,
 * declared source, DRAFT status, and refreshed timestamps. Used by both the
 * "duplicate design" and "use template" clone flows so history never mutates.
 */
export function cloneDesignJson(
  source: NotificationDesign,
  overrides: { id: string; name: string; source: DesignSource },
): NotificationDesign {
  const now = new Date().toISOString();
  return {
    ...source,
    id: overrides.id,
    name: overrides.name,
    status: "DRAFT",
    metadata: {
      createdAt: now,
      updatedAt: now,
      source: overrides.source,
    },
  };
}
