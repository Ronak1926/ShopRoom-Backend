/**
 * utils/zonedTime.ts — IANA time-zone arithmetic on top of Intl, so scheduled
 * sends follow the shopkeeper's wall clock ("every day at 10:00 in
 * Asia/Kolkata") across DST changes without pulling in a date library.
 */

export interface CivilDate {
  year: number;
  month: number; // 1-12
  day: number;
}

export interface CivilDateTime extends CivilDate {
  hour: number;
  minute: number;
}

export interface ZonedParts extends CivilDateTime {
  second: number;
  /** 0 = Sunday */
  weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

export function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const parts: Record<string, number> = {};
  for (const p of formatterFor(timeZone).formatToParts(date)) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
    weekday,
  };
}

/** Milliseconds the zone's wall clock is ahead of UTC at the given instant. */
function offsetMs(date: Date, timeZone: string): number {
  const p = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * The UTC instant at which the zone's wall clock reads `local`. A wall time
 * that does not exist (spring-forward gap) resolves to the instant just after
 * the gap; an ambiguous one (fall-back) resolves to its first occurrence.
 */
export function zonedTimeToUtc(local: CivilDateTime, timeZone: string): Date {
  const guess = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  const firstOffset = offsetMs(new Date(guess), timeZone);
  let utc = guess - firstOffset;
  const secondOffset = offsetMs(new Date(utc), timeZone);
  if (secondOffset !== firstOffset) utc = guess - secondOffset;
  return new Date(utc);
}

/** UTC instant of 00:00 on the zone's calendar day that contains `date`. */
export function startOfZonedDay(date: Date, timeZone: string): Date {
  const p = getZonedParts(date, timeZone);
  return zonedTimeToUtc({ year: p.year, month: p.month, day: p.day, hour: 0, minute: 0 }, timeZone);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Pure calendar arithmetic — no time zone involved. */
export function addDays(date: CivilDate, days: number): CivilDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function weekdayOf(date: CivilDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

export function toIsoDate(date: CivilDate): string {
  const mm = String(date.month).padStart(2, "0");
  const dd = String(date.day).padStart(2, "0");
  return `${date.year}-${mm}-${dd}`;
}
