import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createCustomer, createDesign, createShop, integrationConfigured, resetDatabase, stubSendEach } from "../test/integration.js";
import { startTestApp, type TestApp } from "../test/http.js";
import { getZonedParts } from "../utils/zonedTime.js";

const enabled = integrationConfigured();
const FULL = { quietFrom: "22:00", quietTo: "08:00", weekendSending: false, expiryHours: 72, defaultType: "PROMOTIONAL", cornerRadius: 16, channels: ["PUSH", "IN_APP"], showAppLogo: true };

describe("notification preferences", { skip: !enabled }, () => {
  let t: TestApp;
  let stub: ReturnType<typeof stubSendEach>;

  before(async () => {
    t = await startTestApp();
  });
  after(() => t.close());
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    t.clearSessionCache();
    t.newClientIp();
    stub = stubSendEach(t.firebaseMessaging);
  });

  async function shop() {
    const made = await createShop(t.prisma);
    const designId = await createDesign(t.prisma, made.shopkeeperId);
    await createCustomer(t.prisma, { member: { roomId: made.roomId } });
    return { ...made, designId, token: t.shopkeeperToken(made.shopkeeperId) };
  }
  const save = (token: string, body: unknown) => t.call("PUT", "/api/notifications/preferences", { token, body });

  /** A schedule body for a given local wall-clock time on a given date, in Asia/Kolkata. */
  const scheduleAt = (designId: string, localIso: string) => ({
    source: "DESIGN",
    notificationId: designId,
    audience: { includeMembers: true, includeNearby: false, radiusKm: 5, includeFutureMembers: true, skipNotificationsOff: true },
    schedule: { sendAt: `${localIso}+05:30`, timeZone: "Asia/Kolkata", recurrence: "ONCE", repeatEvery: 1, weekdays: [], endMode: "NEVER", endDate: null, endAfter: null, deliverySpeed: "STANDARD" },
  });
  /** The next occurrence of a weekday (0 = Sunday) at least two days ahead, as YYYY-MM-DD in Kolkata. */
  function upcoming(weekday: number): string {
    const d = new Date(Date.now() + 2 * 86_400_000);
    for (let i = 0; i < 8; i += 1) {
      const p = getZonedParts(new Date(d.getTime() + i * 86_400_000), "Asia/Kolkata");
      if (p.weekday === weekday) return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
    }
    throw new Error("unreachable");
  }

  describe("saving and loading", () => {
    it("stores them per shopkeeper and hands them back", async () => {
      const a = await shop();
      const b = await shop();
      assert.deepEqual((await t.call("GET", "/api/notifications/preferences", { token: a.token })).json, { data: { quietFrom: "00:00", quietTo: "00:00", weekendSending: true, expiryHours: 24 } });
      assert.equal((await save(a.token, FULL)).status, 200);
      assert.deepEqual((await t.call("GET", "/api/notifications/preferences", { token: a.token })).json.data, FULL);
      assert.equal((await t.call("GET", "/api/notifications/preferences", { token: b.token })).json.data.expiryHours, 24, "another shop is untouched");
    });

    it("reports null for a shop that has never saved any", async () => {
      const made = await shop();
      await t.prisma.notificationPreference.deleteMany({ where: { shopkeeperId: made.shopkeeperId } });
      assert.deepEqual((await t.call("GET", "/api/notifications/preferences", { token: made.token })).json, { data: null });
    });

    it("rejects bad times, expiries and oversized or nested payloads", async () => {
      const s = await shop();
      const bad: unknown[] = [
        { ...FULL, quietFrom: "25:00" },
        { ...FULL, quietTo: "8am" },
        { ...FULL, weekendSending: "yes" },
        { ...FULL, expiryHours: 5 },
        { quietFrom: "22:00" },
        { ...FULL, nested: { a: 1 } },
        { ...FULL, huge: "x".repeat(201) },
        { ...FULL, list: Array(11).fill("a") },
        Object.fromEntries([...Object.entries(FULL), ...Array.from({ length: 70 }, (_, i) => [`k${i}`, 1])]),
        "not an object",
      ];
      for (const body of bad) assert.equal((await save(s.token, body)).status, 400, JSON.stringify(body).slice(0, 60));
      const kept = await t.prisma.notificationPreference.findUniqueOrThrow({ where: { shopkeeperId: s.shopkeeperId } });
      assert.deepEqual(kept.settings, { quietFrom: "00:00", quietTo: "00:00", weekendSending: true, expiryHours: 24 }, "nothing from the rejected requests was saved");
    });

    it("needs a shopkeeper session", async () => {
      assert.equal((await t.call("GET", "/api/notifications/preferences")).status, 401);
      assert.equal((await t.call("PUT", "/api/notifications/preferences", { body: FULL })).status, 401);
    });
  });

  describe("quiet hours and weekends on scheduled sends", () => {
    it("refuses a schedule inside quiet hours, and accepts the same day outside them", async () => {
      const s = await shop();
      await save(s.token, { ...FULL, weekendSending: true });
      const day = upcoming(3);
      const night = await t.call("POST", "/api/notifications/schedules", { token: s.token, body: scheduleAt(s.designId, `${day}T23:30:00`) });
      assert.equal(night.status, 400);
      assert.match(night.json.message, /quiet hours/i);
      const early = await t.call("POST", "/api/notifications/schedules", { token: s.token, body: scheduleAt(s.designId, `${day}T06:00:00`) });
      assert.equal(early.status, 400);
      const fine = await t.call("POST", "/api/notifications/schedules", { token: s.token, body: scheduleAt(s.designId, `${day}T11:00:00`) });
      assert.equal(fine.status, 201, JSON.stringify(fine.json));
    });

    it("refuses a weekend schedule only while weekend sending is off", async () => {
      const s = await shop();
      await save(s.token, FULL);
      const saturday = upcoming(6);
      const blocked = await t.call("POST", "/api/notifications/schedules", { token: s.token, body: scheduleAt(s.designId, `${saturday}T11:00:00`) });
      assert.equal(blocked.status, 400);
      assert.match(blocked.json.message, /weekend/i);
      await save(s.token, { ...FULL, weekendSending: true });
      const allowed = await t.call("POST", "/api/notifications/schedules", { token: s.token, body: scheduleAt(s.designId, `${saturday}T11:00:00`) });
      assert.equal(allowed.status, 201);
    });

    it("applies the defaults the Preferences screen shows to a shop that never saved any", async () => {
      const s = await shop();
      await t.prisma.notificationPreference.deleteMany({ where: { shopkeeperId: s.shopkeeperId } });
      const res = await t.call("POST", "/api/notifications/schedules", { token: s.token, body: scheduleAt(s.designId, `${upcoming(2)}T23:00:00`) });
      assert.equal(res.status, 400, "22:00-08:00 is the default");
    });

    it("skips an occurrence that breaks the rules by the time it fires, and records why", async () => {
      const s = await shop();
      const day = upcoming(2);
      const created = await t.call("POST", "/api/notifications/schedules", { token: s.token, body: scheduleAt(s.designId, `${day}T11:00:00`) });
      assert.equal(created.status, 201);
      const id = created.json.data.id as string;
      // The occurrence is due now. The shopkeeper then adds quiet hours covering the current time in Kolkata.
      const hour = getZonedParts(new Date(), "Asia/Kolkata").hour;
      const pad = (h: number) => `${String((h + 24) % 24).padStart(2, "0")}:00`;
      await save(s.token, { ...FULL, quietFrom: pad(hour - 2), quietTo: pad(hour + 2), weekendSending: true });
      await t.prisma.$executeRaw`UPDATE "NotificationSchedule" SET "nextRunAt" = (now() at time zone 'utc') - interval '1 minute' WHERE "id" = ${id}`;

      const { runDueSchedules } = await import("../services/notificationScheduler.service.js");
      assert.equal(await runDueSchedules(), 1);
      const send = await t.prisma.notificationSend.findFirstOrThrow({ where: { scheduleId: id } });
      assert.equal(send.status, "FAILED");
      assert.equal(send.failureReason, "QUIET_HOURS");
      assert.equal(stub.messages().length, 0, "nothing was sent");
    });

    it("never blocks an immediate send: that is the shopkeeper acting right now", async () => {
      const s = await shop();
      await save(s.token, { ...FULL, quietFrom: "00:00", quietTo: "23:59", weekendSending: false });
      const res = await t.call("POST", "/api/notifications/send", { token: s.token, body: { source: "DESIGN", notificationId: s.designId, audience: { mode: "ROOM_MEMBERS", radiusKm: 5 }, message: "Hi" } });
      assert.equal(res.status, 201, JSON.stringify(res.json));
    });
  });

  describe("expiry", () => {
    it("sets how long the push service keeps an undelivered push", async () => {
      const s = await shop();
      const send = async (hours: number) => {
        stub.batches.length = 0;
        await save(s.token, { ...FULL, weekendSending: true, expiryHours: hours });
        const res = await t.call("POST", "/api/notifications/send", { token: s.token, body: { source: "DESIGN", notificationId: s.designId, audience: { mode: "ROOM_MEMBERS", radiusKm: 5 }, message: "Hi" } });
        assert.equal(res.status, 201, JSON.stringify(res.json));
        const message = stub.messages()[0] as unknown as { android: { ttl: number }; webpush: { headers: { TTL: string } } };
        return [message.webpush.headers.TTL, message.android.ttl];
      };
      assert.deepEqual(await send(1), ["3600", 3_600_000]);
      await t.prisma.notificationSend.deleteMany();
      assert.deepEqual(await send(72), [String(72 * 3600), 72 * 3_600_000]);
    });
  });
});
