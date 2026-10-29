/**
 * utils/scheduleRecurrence.ts — Pure recurrence engine for scheduled sends.
 * Occurrences are defined on the shopkeeper's wall clock (time zone + local
 * time of the first run), then converted to UTC instants, so "daily at 10:00"
 * stays at 10:00 across DST changes.
 */

import {
  addDays,
  daysInMonth,
  getZonedParts,
  toIsoDate,
  weekdayOf,
  zonedTimeToUtc,
  type CivilDate,
} from "./zonedTime.js";

export type Recurrence = "ONCE" | "DAILY" | "WEEKLY" | "MONTHLY";
export type EndMode = "NEVER" | "ON" | "AFTER";

export interface RecurrenceSpec {
  firstRunAt: Date;
  timeZone: string;
  recurrence: Recurrence;
  repeatEvery: number;
  /** 0 = Sunday. Used by WEEKLY only. */
  weekdays: number[];
  endMode: EndMode;
  /** "YYYY-MM-DD" in `timeZone`, inclusive. Used when endMode is ON. */
  endDate: string | null;
  /** Total number of occurrences. Used when endMode is AFTER. */
  endAfter: number | null;
}

/** Guards the occurrence walk against a pathological spec. */
const MAX_ITERATIONS = 50_000;

function* civilDates(spec: RecurrenceSpec, base: CivilDate): Generator<CivilDate> {
  switch (spec.recurrence) {
    case "ONCE":
      yield base;
      return;
    case "DAILY":
      for (let k = 0; ; k += 1) yield addDays(base, k * spec.repeatEvery);
    case "WEEKLY": {
      const days = Array.from(new Set(spec.weekdays)).sort((a, b) => a - b);
      if (days.length === 0) return;
      const weekStart = addDays(base, -weekdayOf(base));
      const baseKey = toIsoDate(base);
      for (let w = 0; ; w += 1) {
        const weekDate = addDays(weekStart, w * spec.repeatEvery * 7);
        for (const wd of days) {
          const date = addDays(weekDate, wd);
          if (toIsoDate(date) >= baseKey) yield date;
        }
      }
    }
    case "MONTHLY":
      for (let k = 0; ; k += 1) {
        const index = base.month - 1 + k * spec.repeatEvery;
        const year = base.year + Math.floor(index / 12);
        const month = (index % 12) + 1;
        yield { year, month, day: Math.min(base.day, daysInMonth(year, month)) };
      }
  }
}

/**
 * The first occurrence strictly after `after`, or null when the series has
 * ended (ONCE already past, end date reached, or occurrence count exhausted).
 */
export function nextRunAfter(spec: RecurrenceSpec, after: Date): Date | null {
  const first = getZonedParts(spec.firstRunAt, spec.timeZone);
  const base: CivilDate = { year: first.year, month: first.month, day: first.day };

  let index = 0;
  for (const date of civilDates(spec, base)) {
    index += 1;
    if (index > MAX_ITERATIONS) return null;
    if (spec.endMode === "AFTER" && spec.endAfter !== null && index > spec.endAfter) return null;
    if (spec.endMode === "ON" && spec.endDate !== null && toIsoDate(date) > spec.endDate) {
      return null;
    }
    const at = zonedTimeToUtc({ ...date, hour: first.hour, minute: first.minute }, spec.timeZone);
    if (at.getTime() > after.getTime()) return at;
  }
  return null;
}
