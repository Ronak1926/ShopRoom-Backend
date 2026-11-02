import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createDesign, createShop, createCustomer, integrationConfigured, resetDatabase, stubSendEach } from "../test/integration.js";
import { startTestApp, type TestApp } from "../test/http.js";
import { DAY_MS, PLANS, planEndsAt } from "../services/plans.js";

const enabled = integrationConfigured();
const DAY = DAY_MS;

describe("plan expiry, billing and renewal", { skip: !enabled }, () => {
  let t: TestApp;
  let stub: ReturnType<typeof stubSendEach>;

  before(async () => {
    // These tests use the credential-less development payment flow (mock orders).
    for (const name of Object.keys(process.env)) if (/^RAZORPAY_/.test(name)) delete process.env[name];
    delete process.env.NODE_ENV;
    t = await startTestApp();
  });
  after(() => t.close());
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    t.clearSessionCache();
    t.newClientIp();
    stub = stubSendEach(t.firebaseMessaging);
  });

  async function shop(planEndsInMs: number, planType = "3m") {
    const made = await createShop(t.prisma, { planType });
    await t.prisma.shopkeeper.update({ where: { id: made.shopkeeperId }, data: { planExpiresAt: new Date(Date.now() + planEndsInMs) } });
    const designId = await createDesign(t.prisma, made.shopkeeperId);
    await createCustomer(t.prisma, { member: { roomId: made.roomId } });
    return { ...made, designId, token: t.shopkeeperToken(made.shopkeeperId) };
  }

  const sendBody = (designId: string) => ({ source: "DESIGN", notificationId: designId, audience: { mode: "ROOM_MEMBERS", radiusKm: 5 }, message: "Hi" });
  const scheduleBody = (designId: string) => ({
    source: "DESIGN",
    notificationId: designId,
    audience: { includeMembers: true, includeNearby: false, radiusKm: 5, includeFutureMembers: true, skipNotificationsOff: true },
    schedule: {
      sendAt: new Date(Date.now() + 3_600_000).toISOString(),
      timeZone: "Asia/Kolkata",
      recurrence: "ONCE",
      repeatEvery: 1,
      weekdays: [],
      endMode: "NEVER",
      endDate: null,
      endAfter: null,
      deliverySpeed: "STANDARD",
    },
  });

  describe("an expired plan", () => {
    it("refuses to send and says how to fix it, without spending the daily allowance", async () => {
      const s = await shop(-DAY);
      const res = await t.call("POST", "/api/notifications/send", { token: s.token, body: sendBody(s.designId) });
      assert.equal(res.status, 402);
      assert.match(res.json.message, /expired.*Billing/i);
      assert.equal(stub.messages().length, 0, "nothing reached FCM");
      assert.equal(await t.prisma.notificationSend.count(), 0);
    });

    it("refuses to create a schedule", async () => {
      const s = await shop(-DAY);
      const res = await t.call("POST", "/api/notifications/schedules", { token: s.token, body: scheduleBody(s.designId) });
      assert.equal(res.status, 402);
      assert.equal(await t.prisma.notificationSchedule.count(), 0);
    });

    it("keeps the account usable: sign-in, data, designs and billing all still work", async () => {
      const s = await shop(-DAY);
      for (const path of ["/api/shop/me", "/api/shop/dashboard", "/api/notifications/designs", "/api/notifications/sends", "/api/shopkeeper/billing"]) {
        assert.equal((await t.call("GET", path, { token: s.token })).status, 200, path);
      }
    });

    it("tells the studio the plan is inactive", async () => {
      const s = await shop(-DAY);
      const caps = (await t.call("GET", "/api/notifications/capabilities", { token: s.token })).json.data;
      assert.equal(caps.planActive, false);
      const live = await shop(5 * DAY);
      assert.equal((await t.call("GET", "/api/notifications/capabilities", { token: live.token })).json.data.planActive, true);
    });

    it("records a scheduled run as PLAN_EXPIRED instead of sending, and carries the series on", async () => {
      const s = await shop(5 * DAY);
      const created = await t.call("POST", "/api/notifications/schedules", { token: s.token, body: scheduleBody(s.designId) });
      assert.equal(created.status, 201, JSON.stringify(created.json));
      const id = created.json.data.id as string;
      // Make it due now, and let the plan lapse before it fires.
      await t.prisma.$executeRaw`UPDATE "NotificationSchedule" SET "nextRunAt" = (now() at time zone 'utc') - interval '1 minute' WHERE "id" = ${id}`;
      await t.prisma.shopkeeper.update({ where: { id: s.shopkeeperId }, data: { planExpiresAt: new Date(Date.now() - DAY) } });

      const { runDueSchedules } = await import("../services/notificationScheduler.service.js");
      assert.equal(await runDueSchedules(), 1);
      const send = await t.prisma.notificationSend.findFirstOrThrow({ where: { scheduleId: id } });
      assert.equal(send.status, "FAILED");
      assert.equal(send.failureReason, "PLAN_EXPIRED");
      assert.equal(stub.messages().length, 0);
    });
  });

  describe("GET /api/shopkeeper/billing", () => {
    it("reports the plan, time left, prices and payment history", async () => {
      const s = await shop(10 * DAY, "2m");
      const res = await t.call("GET", "/api/shopkeeper/billing", { token: s.token });
      assert.equal(res.status, 200);
      const b = res.json.data;
      assert.equal(b.planType, "2m");
      assert.equal(b.active, true);
      assert.equal(b.daysLeft, 10);
      assert.deepEqual(b.plans.map((p: { id: string; priceInr: number }) => [p.id, p.priceInr]), [["1m", 399], ["2m", 599], ["3m", 899]]);
      assert.deepEqual(b.payments, []);
    });

    it("needs a shopkeeper session", async () => {
      assert.equal((await t.call("GET", "/api/shopkeeper/billing")).status, 401);
      const customer = await createCustomer(t.prisma);
      assert.equal((await t.call("GET", "/api/shopkeeper/billing", { token: t.customerToken(customer.customerId) })).status, 401);
    });
  });

  describe("renewing", () => {
    async function renew(s: { token: string }, planType: string, paymentId: string, orderId?: string) {
      const order = orderId ? { orderId } : (await t.call("POST", "/api/shopkeeper/billing/order", { token: s.token, body: { planType } })).json.data;
      return t.call("POST", "/api/shopkeeper/billing/verify", {
        token: s.token,
        body: { planType, razorpayOrderId: order.orderId, razorpayPaymentId: paymentId, razorpaySignature: "dev" },
      });
    }

    it("revives an expired plan from now, and sending works again", async () => {
      const s = await shop(-3 * DAY, "1m");
      const res = await renew(s, "3m", "pay_renew_1");
      assert.equal(res.status, 200, JSON.stringify(res.json));
      const b = res.json.data;
      assert.equal(b.planType, "3m");
      assert.equal(b.active, true);
      assert.equal(b.daysLeft, 90);
      assert.equal(b.payments[0].purpose, "RENEWAL");
      assert.equal(b.payments[0].amountInr, 899);

      const sent = await t.call("POST", "/api/notifications/send", { token: s.token, body: sendBody(s.designId) });
      assert.equal(sent.status, 201, JSON.stringify(sent.json));
    });

    it("adds to the time that is left instead of throwing it away", async () => {
      const s = await shop(10 * DAY, "1m");
      const res = await renew(s, "2m", "pay_renew_2");
      assert.equal(res.json.data.daysLeft, 70, "10 days left + 60 bought");
    });

    it("applies two renewals that land together one after the other", async () => {
      const s = await shop(0, "1m");
      const orders = await Promise.all([1, 2].map(() => t.call("POST", "/api/shopkeeper/billing/order", { token: s.token, body: { planType: "1m" } })));
      const results = await Promise.all(orders.map((o, i) => renew(s, "1m", `pay_race_${i}`, o.json.data.orderId)));
      assert.deepEqual(results.map((r) => r.status), [200, 200]);
      const row = await t.prisma.shopkeeper.findUniqueOrThrow({ where: { id: s.shopkeeperId } });
      const daysLeft = (row.planExpiresAt.getTime() - Date.now()) / DAY;
      assert.ok(daysLeft > 59 && daysLeft <= 60, `two 30-day renewals = ~60 days, got ${daysLeft.toFixed(1)}`);
    });

    it("refuses a payment that was already used, even for another account", async () => {
      const a = await shop(-DAY, "1m");
      const b = await shop(-DAY, "1m");
      assert.equal((await renew(a, "1m", "pay_once_only")).status, 200);
      const replay = await renew(b, "1m", "pay_once_only");
      assert.equal(replay.status, 409);
      const stillExpired = await t.call("GET", "/api/shopkeeper/billing", { token: b.token });
      assert.equal(stillExpired.json.data.active, false);
    });

    it("refuses another shopkeeper's order", async () => {
      const a = await shop(-DAY, "1m");
      const b = await shop(-DAY, "1m");
      const aOrder = (await t.call("POST", "/api/shopkeeper/billing/order", { token: a.token, body: { planType: "1m" } })).json.data.orderId;
      const stolen = await renew(b, "1m", "pay_stolen", aOrder);
      assert.equal(stolen.status, 400);
      assert.match(stolen.json.message, /does not belong/);
      assert.equal(await t.prisma.planPayment.count(), 0);
    });

    it("refuses a paid order replayed against a different plan only when the amount is known", async () => {
      const { assertOrderMatchesPlan } = await import("../services/shopkeeper.service.js");
      assert.throws(() => assertOrderMatchesPlan({ amount: PLANS["1m"].amount, receipt: "sk_abc" }, "x", "3m"));
    });

    it("rejects an unknown plan and malformed payment details", async () => {
      const s = await shop(-DAY);
      assert.equal((await t.call("POST", "/api/shopkeeper/billing/order", { token: s.token, body: { planType: "12m" } })).status, 400);
      assert.equal((await t.call("POST", "/api/shopkeeper/billing/verify", { token: s.token, body: { planType: "1m" } })).status, 400);
      assert.equal(await t.prisma.planPayment.count(), 0);
    });

    it("needs a session", async () => {
      assert.equal((await t.call("POST", "/api/shopkeeper/billing/order", { body: { planType: "1m" } })).status, 401);
      assert.equal((await t.call("POST", "/api/shopkeeper/billing/verify", { body: {} })).status, 401);
    });

    it("fails closed in production without payment credentials", async () => {
      const s = await shop(-DAY);
      const previous = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      try {
        const order = await t.call("POST", "/api/shopkeeper/billing/order", { token: s.token, body: { planType: "1m" } });
        assert.equal(order.status, 500);
        const verify = await t.call("POST", "/api/shopkeeper/billing/verify", {
          token: s.token,
          body: { planType: "1m", razorpayOrderId: "order_mock_rn_x_1", razorpayPaymentId: "pay_x", razorpaySignature: "x" },
        });
        assert.equal(verify.status, 400, "an unverifiable signature never renews");
      } finally {
        if (previous === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previous;
      }
      assert.equal((await t.call("GET", "/api/shopkeeper/billing", { token: s.token })).json.data.active, false);
    });
  });

  it("lists the payment history newest first", async () => {
    const s = await shop(DAY);
    const at = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY);
    await t.prisma.planPayment.createMany({
      data: [
        { shopkeeperId: s.shopkeeperId, purpose: "REGISTRATION", planType: "1m", amount: 39_900, razorpayOrderId: "order_a", razorpayPaymentId: "pay_a", createdAt: at(40) },
        { shopkeeperId: s.shopkeeperId, purpose: "RENEWAL", planType: "2m", amount: 59_900, razorpayOrderId: "order_b", razorpayPaymentId: "pay_b", createdAt: at(5) },
      ],
    });
    const history = (await t.call("GET", "/api/shopkeeper/billing", { token: s.token })).json.data.payments;
    assert.deepEqual(history.map((p: { purpose: string }) => p.purpose), ["RENEWAL", "REGISTRATION"]);
    assert.equal(JSON.stringify(history).includes("razorpay"), false, "payment ids are not sent to the browser");
  });
});

describe("planEndsAt", () => {
  it("starts from now for a lapsed plan and from the end date for a live one", () => {
    const now = new Date("2026-11-01T00:00:00Z");
    assert.equal(planEndsAt("1m", new Date("2026-10-01T00:00:00Z"), now).toISOString(), "2026-12-01T00:00:00.000Z");
    assert.equal(planEndsAt("1m", new Date("2026-11-11T00:00:00Z"), now).toISOString(), "2026-12-11T00:00:00.000Z");
    assert.equal(planEndsAt("3m", null, now).toISOString(), "2027-01-30T00:00:00.000Z");
  });
});
