/**
 * schemas/notificationRequests.schema.ts — Request-body validators for the
 * notification API. These sit at the HTTP boundary; the canonical design shape
 * lives in notification.schema.ts and is reused here.
 */

import z from "zod";
import {
  NotificationDesignSchema,
  NotificationTypeSchema,
  DESIGN_STATUSES,
} from "./notification.schema.js";

/** POST /api/notifications/designs — create a blank (or template-seeded) design. */
export const CreateDesignSchema = z.object({
  name: z.string().min(1).max(120),
  category: NotificationTypeSchema.default("CUSTOM"),
  templateId: z.string().max(64).optional(),
});

/** PATCH /api/notifications/designs/:id — autosave. At least one field required. */
export const PatchDesignSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    status: z.enum(DESIGN_STATUSES).optional(),
    design: NotificationDesignSchema.optional(),
  })
  .refine((b) => b.name !== undefined || b.status !== undefined || b.design !== undefined, {
    message: "Provide at least one of name, status or design",
  });

/** POST /api/notifications/validate-design — validate before save/send. */
export const ValidateDesignSchema = z.object({
  design: NotificationDesignSchema,
});

/** POST /api/notifications/assets — upload an image asset (base64 data URI). */
export const UploadAssetSchema = z.object({
  image: z
    .string()
    .max(15_000_000) // ~11MB of base64
    .regex(/^data:image\/(png|jpe?g|webp);base64,/, "Expected a base64 image data URI"),
  width: z.number().int().positive().max(10000).optional(),
  height: z.number().int().positive().max(10000).optional(),
  sizeBytes: z.number().int().positive().max(10_000_000).optional(),
});

/** GET /api/notifications/designs — list query. */
export const ListDesignsQuerySchema = z.object({
  archived: z.enum(["true", "false"]).optional(),
  status: z.enum(DESIGN_STATUSES).optional(),
  page: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** GET /api/notifications/animations — optional category filter. */
export const ListAnimationsQuerySchema = z.object({
  category: z.enum(["ENTRY", "ATTENTION", "CLICK", "EXIT"]).optional(),
});

/** GET /api/notifications/stock-images — Pexels/Unsplash search. */
export const StockImageSearchQuerySchema = z.object({
  query: z.string().min(1).max(200),
  category: z.string().max(60).optional(),
  provider: z.enum(["PEXELS", "UNSPLASH"]).optional(),
  page: z.coerce.number().int().min(1).max(50).default(1),
});

export type CreateDesignInput = z.infer<typeof CreateDesignSchema>;
export type PatchDesignInput = z.infer<typeof PatchDesignSchema>;
export type UploadAssetInput = z.infer<typeof UploadAssetSchema>;
export type ListDesignsQuery = z.infer<typeof ListDesignsQuerySchema>;
export type StockImageSearchQuery = z.infer<typeof StockImageSearchQuerySchema>;
