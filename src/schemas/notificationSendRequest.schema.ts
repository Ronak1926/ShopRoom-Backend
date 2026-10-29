import { z } from "zod";

/** Mirrors the frontend's SendNotificationBody (features/notifications/api.ts). */
export const SendNotificationSchema = z.object({
  source: z.enum(["DESIGN", "TEMPLATE"]),
  notificationId: z.string().min(1),
  audience: z.object({
    mode: z.enum(["ROOM_MEMBERS", "NEARBY", "MEMBERS_NEARBY"]),
    radiusKm: z.number().min(1).max(25),
  }),
  message: z.string().max(100).optional(),
});

export type SendNotificationInput = z.infer<typeof SendNotificationSchema>;
