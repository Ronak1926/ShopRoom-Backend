import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextRunAfter, type RecurrenceSpec } from "./scheduleRecurrence.js";
import { isValidTimeZone, startOfZonedDay, zonedTimeToUtc } from "./zonedTime.js";

const IST = "Asia/Kolkata";
const NY = "America/New_York";

function spec(overrides: Partial<RecurrenceSpec>): RecurrenceSpec {
  return {
    firstRunAt: new Date("2026-05-04T04:30:00Z"), // Mon 10:00 IST
    timeZone: IST,
    recurrence: "ONCE",
    repeatEvery: 1,
    weekdays: [],
    endMode: "NEVER",
    endDate: null,
    endAfter: null,
    ...overrides,
  };
}

/** Walks the whole series from `start`, returning every occurrence. */
function series(s: RecurrenceSpec, limit = 20): string[] {
  const out: string[] = [];
  let cursor = new Date(s.firstRunAt.getTime() - 1);
  for (let i = 0; i < limit; i += 1) {
    const next = nextRunAfter(s, cursor);
    if (!next) break;
    out.push(next.toISOString());
    cursor = next;
  }
  return out;
}

describe("zonedTime", () => {
  it("converts Asia/Kolkata wall time (UTC+5:30, no DST)", () => {
    const utc = zonedTimeToUtc({ year: 2026, month: 5, day: 4, hour: 10, minute: 0 }, IST);
    assert.equal(utc.toISOString(), "2026-05-04T04:30:00.000Z");
  });

  it("tracks the DST shift in America/New_York", () => {
    const before = zonedTimeToUtc({ year: 2026, month: 3, day: 7, hour: 9, minute: 0 }, NY);
    const after = zonedTimeToUtc({ year: 2026, month: 3, day: 9, hour: 9, minute: 0 }, NY);
    assert.equal(before.toISOString(), "2026-03-07T14:00:00.000Z"); // EST, UTC-5
    assert.equal(after.toISOString(), "2026-03-09T13:00:00.000Z"); // EDT, UTC-4
  });

  it("finds the start of the zone's calendar day", () => {
    const start = startOfZonedDay(new Date("2026-05-04T20:00:00Z"), IST); // 01:30 IST on the 5th
    assert.equal(start.toISOString(), "2026-05-04T18:30:00.000Z");
  });

  it("validates IANA zone names", () => {
    assert.equal(isValidTimeZone("Asia/Kolkata"), true);
    assert.equal(isValidTimeZone("Not/AZone"), false);
  });
});

describe("nextRunAfter", () => {
  it("ONCE yields the first run only while it is still ahead", () => {
    const s = spec({});
    assert.equal(nextRunAfter(s, new Date("2026-05-01T00:00:00Z"))?.toISOString(), "2026-05-04T04:30:00.000Z");
    assert.equal(nextRunAfter(s, new Date("2026-05-04T04:30:00Z")), null);
  });

  it("DAILY repeats at the same local time", () => {
    const out = series(spec({ recurrence: "DAILY" }), 3);
    assert.deepEqual(out, [
      "2026-05-04T04:30:00.000Z",
      "2026-05-05T04:30:00.000Z",
      "2026-05-06T04:30:00.000Z",
    ]);
  });

  it("DAILY honours repeatEvery", () => {
    const out = series(spec({ recurrence: "DAILY", repeatEvery: 3 }), 3);
    assert.deepEqual(out, [
      "2026-05-04T04:30:00.000Z",
      "2026-05-07T04:30:00.000Z",
      "2026-05-10T04:30:00.000Z",
    ]);
  });

  it("DAILY keeps the local hour across a DST change", () => {
    const s = spec({
      firstRunAt: new Date("2026-03-07T14:00:00Z"), // 09:00 EST
      timeZone: NY,
      recurrence: "DAILY",
    });
    assert.deepEqual(series(s, 3), [
      "2026-03-07T14:00:00.000Z",
      "2026-03-08T13:00:00.000Z", // 09:00 EDT — the clocks moved overnight
      "2026-03-09T13:00:00.000Z",
    ]);
  });

  it("WEEKLY visits the chosen weekdays in order, skipping days before the first run", () => {
    // First run is Monday; Mon + Wed + Sun selected (Sunday of that week is already past).
    const out = series(spec({ recurrence: "WEEKLY", weekdays: [3, 1, 0] }), 5);
    assert.deepEqual(out, [
      "2026-05-04T04:30:00.000Z", // Mon
      "2026-05-06T04:30:00.000Z", // Wed
      "2026-05-10T04:30:00.000Z", // Sun
      "2026-05-11T04:30:00.000Z", // Mon
      "2026-05-13T04:30:00.000Z", // Wed
    ]);
  });

  it("WEEKLY honours repeatEvery weeks", () => {
    const out = series(spec({ recurrence: "WEEKLY", weekdays: [1], repeatEvery: 2 }), 3);
    assert.deepEqual(out, [
      "2026-05-04T04:30:00.000Z",
      "2026-05-18T04:30:00.000Z",
      "2026-06-01T04:30:00.000Z",
    ]);
  });

  it("MONTHLY clamps to the shorter month without drifting", () => {
    const s = spec({
      firstRunAt: new Date("2026-01-31T04:30:00Z"),
      recurrence: "MONTHLY",
    });
    assert.deepEqual(series(s, 4), [
      "2026-01-31T04:30:00.000Z",
      "2026-02-28T04:30:00.000Z",
      "2026-03-31T04:30:00.000Z", // back on the 31st, not stuck on the 28th
      "2026-04-30T04:30:00.000Z",
    ]);
  });

  it("endMode AFTER stops after N occurrences", () => {
    const out = series(spec({ recurrence: "DAILY", endMode: "AFTER", endAfter: 2 }), 10);
    assert.equal(out.length, 2);
  });

  it("endMode ON includes the end date and stops after it", () => {
    const out = series(spec({ recurrence: "DAILY", endMode: "ON", endDate: "2026-05-06" }), 10);
    assert.equal(out.length, 3);
    assert.equal(out[2], "2026-05-06T04:30:00.000Z");
  });

  it("skips ahead when `after` is far past the first run (missed window)", () => {
    const next = nextRunAfter(spec({ recurrence: "DAILY" }), new Date("2026-05-20T12:00:00Z"));
    assert.equal(next?.toISOString(), "2026-05-21T04:30:00.000Z");
  });

  it("a WEEKLY spec with no weekdays has no occurrences", () => {
    assert.equal(nextRunAfter(spec({ recurrence: "WEEKLY", weekdays: [] }), new Date(0)), null);
  });
});
