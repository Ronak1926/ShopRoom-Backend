/**
 * utils/quietHours.ts — Is a moment inside a shopkeeper's "do not send" rules?
 *
 * Rules are judged on the wall clock of the schedule's own time zone, the same
 * convention the recurrence engine uses: "22:00-08:00" means 10 pm to 8 am local
 * time wherever the shop is, DST included.
 */

import { getZonedParts } from "./zonedTime.js";

export interface SendRules {
  /** "HH:mm", 24-hour. Equal start and end means no quiet hours. */
  quietFrom: string;
  quietTo: string;
  weekendSending: boolean;
}

export type BlockReason = "QUIET_HOURS" | "WEEKEND";

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function minutesOfDay(hhmm: string): number {
  const match = HHMM.exec(hhmm);
  if (!match) throw new Error(`Invalid time of day: ${hhmm}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

/** True when `minute` (0-1439) falls in [from, to); the window may wrap past midnight. */
export function inQuietWindow(minute: number, from: number, to: number): boolean {
  if (from === to) return false;
  return from < to ? minute >= from && minute < to : minute >= from || minute < to;
}

/** Why a send at `at` is not allowed, or null when it is. Quiet hours are reported before weekends. */
export function blockedBy(rules: SendRules, at: Date, timeZone: string): BlockReason | null {
  const local = getZonedParts(at, timeZone);
  const minute = local.hour * 60 + local.minute;
  if (inQuietWindow(minute, minutesOfDay(rules.quietFrom), minutesOfDay(rules.quietTo))) return "QUIET_HOURS";
  const weekend = local.weekday === 0 || local.weekday === 6;
  if (weekend && !rules.weekendSending) return "WEEKEND";
  return null;
}

export const BLOCK_MESSAGES: Record<BlockReason, string> = {
  QUIET_HOURS: "That time falls inside your quiet hours. Pick another time or change quiet hours in Preferences.",
  WEEKEND: "Weekend sending is turned off in your Preferences. Pick a weekday or turn it on.",
};
