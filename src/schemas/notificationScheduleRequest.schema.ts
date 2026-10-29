import { z } from "zod";
import { isValidTimeZone } from "../utils/zonedTime.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date");

/** Mirrors the frontend's ScheduleNotificationBody (features/notifications/api.ts). */
export const CreateScheduleSchema = z
  .object({
    source: z.enum(["DESIGN", "TEMPLATE"]),
    notificationId: z.string().min(1).max(64),
    message: z.string().max(100).optional(),
    audience: z.object({
      includeMembers: z.boolean(),
      includeNearby: z.boolean(),
      radiusKm: z.number().int().min(1).max(25),
      includeFutureMembers: z.boolean(),
      // Members who switched a room's notifications off are never targeted;
      // the field is accepted for the wizard's contract but cannot be false.
      skipNotificationsOff: z.literal(true),
    }),
    schedule: z.object({
      sendAt: z.iso.datetime({ offset: true }),
      timeZone: z.string().max(64).refine(isValidTimeZone, "Unknown time zone"),
      recurrence: z.enum(["ONCE", "DAILY", "WEEKLY", "MONTHLY"]),
      repeatEvery: z.number().int().min(1).max(30),
      weekdays: z.array(z.number().int().min(0).max(6)).max(7),
      endMode: z.enum(["NEVER", "ON", "AFTER"]),
      endDate: isoDate.nullable(),
      endAfter: z.number().int().min(1).max(365).nullable(),
      deliverySpeed: z.enum(["STANDARD", "PRIORITY"]),
    }),
  })
  .refine((v) => v.audience.includeMembers || v.audience.includeNearby, {
    message: "Pick at least one audience",
    path: ["audience", "includeMembers"],
  })
  .refine((v) => v.schedule.recurrence !== "WEEKLY" || v.schedule.weekdays.length > 0, {
    message: "Pick at least one day of the week",
    path: ["schedule", "weekdays"],
  })
  .refine((v) => v.schedule.endMode !== "ON" || v.schedule.endDate !== null, {
    message: "Pick the date the repeat ends",
    path: ["schedule", "endDate"],
  })
  .refine((v) => v.schedule.endMode !== "AFTER" || v.schedule.endAfter !== null, {
    message: "Set how many times it repeats",
    path: ["schedule", "endAfter"],
  });

export type CreateScheduleInput = z.infer<typeof CreateScheduleSchema>;

export const UpdateScheduleStatusSchema = z.object({
  status: z.enum(["ACTIVE", "PAUSED"]),
});

export const ListSchedulesQuerySchema = z.object({
  state: z.enum(["upcoming", "completed"]).default("upcoming"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
