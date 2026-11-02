import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blockedBy, inQuietWindow, minutesOfDay } from "./quietHours.js";

const night = { quietFrom: "22:00", quietTo: "08:00", weekendSending: true };
const IST = "Asia/Kolkata";
/** A UTC instant that is `hhmm` on the given IST date. */
const ist = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`);

describe("inQuietWindow", () => {
  it("handles a window inside one day", () => {
    const [from, to] = [minutesOfDay("13:00"), minutesOfDay("15:00")];
    assert.equal(inQuietWindow(minutesOfDay("12:59"), from, to), false);
    assert.equal(inQuietWindow(minutesOfDay("13:00"), from, to), true);
    assert.equal(inQuietWindow(minutesOfDay("14:59"), from, to), true);
    assert.equal(inQuietWindow(minutesOfDay("15:00"), from, to), false, "the end is exclusive");
  });

  it("handles a window that wraps past midnight", () => {
    const [from, to] = [minutesOfDay("22:00"), minutesOfDay("08:00")];
    for (const t of ["22:00", "23:59", "00:00", "03:30", "07:59"]) assert.equal(inQuietWindow(minutesOfDay(t), from, to), true, t);
    for (const t of ["08:00", "12:00", "21:59"]) assert.equal(inQuietWindow(minutesOfDay(t), from, to), false, t);
  });

  it("treats equal start and end as no quiet hours", () => {
    assert.equal(inQuietWindow(0, 0, 0), false);
    assert.equal(inQuietWindow(600, 600, 600), false);
  });
});

describe("minutesOfDay", () => {
  it("parses 24-hour times and rejects anything else", () => {
    assert.equal(minutesOfDay("00:00"), 0);
    assert.equal(minutesOfDay("23:59"), 1439);
    for (const bad of ["24:00", "9:00", "12:60", "noon", "", "12:00:00"]) assert.throws(() => minutesOfDay(bad), bad);
  });
});

describe("blockedBy", () => {
  it("allows a daytime weekday send", () => {
    assert.equal(blockedBy(night, ist("2026-11-03", "11:00"), IST), null);
  });

  it("blocks late evening and early morning in the shop's own time zone", () => {
    assert.equal(blockedBy(night, ist("2026-11-03", "22:30"), IST), "QUIET_HOURS");
    assert.equal(blockedBy(night, ist("2026-11-03", "03:00"), IST), "QUIET_HOURS");
    assert.equal(blockedBy(night, ist("2026-11-03", "08:00"), IST), null);
  });

  it("judges the same instant differently in different zones", () => {
    const at = new Date("2026-11-03T05:00:00Z"); // 10:30 in Kolkata, 05:00 in London, 00:00 in New York
    assert.equal(blockedBy(night, at, IST), null);
    assert.equal(blockedBy(night, at, "Europe/London"), "QUIET_HOURS");
    assert.equal(blockedBy(night, at, "America/New_York"), "QUIET_HOURS");
  });

  it("blocks weekends only when weekend sending is off", () => {
    const rules = { ...night, weekendSending: false };
    assert.equal(blockedBy(rules, ist("2026-11-07", "11:00"), IST), "WEEKEND", "Saturday");
    assert.equal(blockedBy(rules, ist("2026-11-08", "11:00"), IST), "WEEKEND", "Sunday");
    assert.equal(blockedBy(rules, ist("2026-11-09", "11:00"), IST), null, "Monday");
    assert.equal(blockedBy(night, ist("2026-11-07", "11:00"), IST), null, "weekends allowed");
  });

  it("uses the shop's weekday, not UTC's", () => {
    // Saturday 00:30 in Kolkata is still Friday in UTC.
    const rules = { ...night, quietFrom: "00:00", quietTo: "00:00", weekendSending: false };
    assert.equal(blockedBy(rules, ist("2026-11-07", "00:30"), IST), "WEEKEND");
  });

  it("reports quiet hours before weekends", () => {
    assert.equal(blockedBy({ ...night, weekendSending: false }, ist("2026-11-07", "23:00"), IST), "QUIET_HOURS");
  });

  it("allows everything when quiet hours are empty and weekends are on", () => {
    const open = { quietFrom: "00:00", quietTo: "00:00", weekendSending: true };
    for (const h of ["00:00", "04:00", "12:00", "23:59"]) assert.equal(blockedBy(open, ist("2026-11-08", h), IST), null, h);
  });
});
