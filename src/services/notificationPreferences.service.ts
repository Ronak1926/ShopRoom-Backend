/**
 * services/notificationPreferences.service.ts — A shopkeeper's notification
 * defaults, kept on the server so they follow the account to every device.
 *
 * Four settings are enforced here, not just remembered:
 *   quietFrom / quietTo / weekendSending — scheduled sends never fire in quiet
 *     hours or on blocked weekends (see notificationSchedule / scheduler);
 *   expiryHours — how long an undelivered push is kept by the push service.
 * Everything else (default type, fonts, colours…) is stored as the studio's
 * starting defaults; the server only bounds its size and shape.
 */

import z from "zod";
import { prisma } from "../database/prisma.js";
import type { Prisma } from "../generated/client.js";
import type { SendRules } from "../utils/quietHours.js";

export const EXPIRY_HOURS = [1, 6, 12, 24, 72, 168] as const;
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected a 24-hour time like 22:00");

/** The settings the server acts on. */
const enforced = {
  quietFrom: hhmm,
  quietTo: hhmm,
  weekendSending: z.boolean(),
  expiryHours: z.number().int().refine((h) => (EXPIRY_HOURS as readonly number[]).includes(h), "Unsupported expiry"),
};

const passive = z.union([z.string().max(200), z.number().finite(), z.boolean(), z.array(z.string().max(40)).max(10)]);

/** What a client may save: the enforced settings, plus a bounded set of passive ones. */
export const PreferencesInputSchema = z
  .object(enforced)
  .catchall(passive)
  .refine((v) => Object.keys(v).length <= 60, "Too many settings");

export type StoredPreferences = z.infer<typeof PreferencesInputSchema>;

export const DEFAULT_RULES: SendRules & { expiryHours: number } = {
  quietFrom: "22:00",
  quietTo: "08:00",
  weekendSending: true,
  expiryHours: 24,
};

export async function getPreferences(shopkeeperId: string): Promise<StoredPreferences | null> {
  const row = await prisma.notificationPreference.findUnique({ where: { shopkeeperId }, select: { settings: true } });
  const parsed = row ? PreferencesInputSchema.safeParse(row.settings) : null;
  return parsed?.success ? parsed.data : null;
}

export async function savePreferences(shopkeeperId: string, settings: StoredPreferences): Promise<void> {
  const json = settings as unknown as Prisma.InputJsonValue;
  await prisma.notificationPreference.upsert({
    where: { shopkeeperId },
    create: { shopkeeperId, settings: json },
    update: { settings: json },
  });
}

/** The rules the server enforces for this shopkeeper: their saved ones, or the defaults the Preferences screen shows. */
export async function getSendRules(shopkeeperId: string): Promise<SendRules & { expiryHours: number }> {
  const saved = await getPreferences(shopkeeperId);
  return saved
    ? { quietFrom: saved.quietFrom, quietTo: saved.quietTo, weekendSending: saved.weekendSending, expiryHours: saved.expiryHours }
    : DEFAULT_RULES;
}
