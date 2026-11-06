/**
 * The whole payment lifecycle against the real app and database, with the real HMAC checks and
 * only the Razorpay network client faked: ordering, browser confirmation, webhooks (including
 * ones that arrive first, twice, or at the same moment), refunds, outages and clean-up.
 */

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { setRazorpayClientForTests, type RazorpayApi } from "../lib/razorpay.js";
import { createShop, integrationConfigured, resetDatabase } from "../test/integration.js";
import { startTestApp, type TestApp } from "../test/http.js";
import { DAY_MS } from "../services/plans.js";

const enabled = integrationConfigured();

const KEY_SECRET = "test_key_secret_123";
const WEBHOOK_SECRET = "test_webhook_secret_456";
const KEY_ID = "rzp_test_abc123XYZ789";
const SHOP = { shopName: "Sunrise Textiles", shopCategory: "Fashion", address: "12 Market Road", city: "Pune", state: "Maharashtra", pincode: "411001" };
const PRICE = { "1m": 39_900, "2m": 59_900, "3m": 89_900 } as const;
const hmac = (secret: string, payload: string) => createHmac("sha256", secret).update(payload).digest("hex");

/** A stand-in for Razorpay's servers that records what we ask of it and can be told to fail. */
function fakeRazorpay() {
  let counter = 0;
  const state = {
    created: [] as Parameters<RazorpayApi["orders"]["create"]>[0][],
    refunds: [] as { paymentId: string; amount: number; notes?: Record<string, string> }[],
    createFailure: null as unknown,
    refundFailure: null as unknown,
  };
  const api: RazorpayApi = {
    orders: {
      async create(body) {
        if (state.createFailure) throw state.createFailure;
        state.created.push(body);
        counter += 1;
        return { id: `order_Fake${counter}`, amount: body.amount, currency: body.currency };
      },
    },
    payments: {
      async refund(paymentId, body) {
        if (state.refundFailure) throw state.refundFailure;
        state.refunds.push({ paymentId, amount: body.amount, notes: body.notes });
        return { id: `rfnd_Fake${state.refunds.length}` };
      },
    },
  };
  return { api, state };
}

describe("payments end to end", { skip: !enabled }, () => {
  let t: TestApp;
  let razorpay: ReturnType<typeof fakeRazorpay>;
  // The jobs read DATABASE_URL when first imported, which the harness sets in startTestApp().
  let purgeExpiredData: typeof import("../services/dataRetention.service.js").purgeExpiredData;
  let retryPendingRefunds: typeof import("../services/paymentSettlement.service.js").retryPendingRefunds;
  const saved: Record<string, string | undefined> = {};

  before(async () => {
    for (const name of Object.keys(process.env)) if (/^(TWILIO|RAZORPAY)_/.test(name)) { saved[name] = process.env[name]; delete process.env[name]; }
    delete process.env.NODE_ENV;
    process.env.RAZORPAY_KEY_ID = KEY_ID;
    process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.LOG_LEVEL = "silent";
    t = await startTestApp();
    ({ purgeExpiredData } = await import("../services/dataRetention.service.js"));
    ({ retryPendingRefunds } = await import("../services/paymentSettlement.service.js"));
  });
  after(async () => {
    setRazorpayClientForTests(null);
    for (const name of ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "LOG_LEVEL"]) delete process.env[name];
    Object.assign(process.env, saved);
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await t.prisma.emailOtp.deleteMany();
    t.clearSessionCache();
    t.newClientIp();
    razorpay = fakeRazorpay();
    setRazorpayClientForTests(razorpay.api);
  });

  // ── helpers ────────────────────────────────────────────────────────────────

  let counter = 0;
  const uniquePhone = () => `9${String(200_000_000 + (counter += 1))}`;

  async function draftReadyToPay() {
    const email = `owner${(counter += 1)}-${Date.now()}@example.test`;
    const init = await t.call("POST", "/api/shopkeeper/draft/init", { body: { email, password: "owner-pass-123" } });
    assert.equal(init.status, 200, JSON.stringify(init.json));
    const draftId = init.json.draftId as string;
    assert.equal((await t.call("PUT", `/api/shopkeeper/draft/${draftId}`, { body: { step: 2, data: SHOP } })).status, 200);
    assert.equal((await t.call("POST", "/api/shopkeeper/phone/send-otp", { body: { draftId, phoneNumber: uniquePhone() } })).status, 200);
    assert.equal((await t.call("POST", "/api/shopkeeper/phone/verify-otp", { body: { draftId, code: "123456" } })).status, 200);
    return { email, draftId };
  }

  const startPayment = (draftId: string, planType = "2m") => t.call("POST", "/api/shopkeeper/payment/create-order", { body: { draftId, planType } });

  async function orderFor(plan: keyof typeof PRICE = "2m") {
    const draft = await draftReadyToPay();
    const res = await startPayment(draft.draftId, plan);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    return { ...draft, orderId: res.json.orderId as string, amount: res.json.amount as number, plan };
  }

  const confirm = (draftId: string, orderId: string, paymentId: string, signature = hmac(KEY_SECRET, `${orderId}|${paymentId}`)) =>
    t.call("POST", "/api/shopkeeper/payment/verify", { body: { draftId, razorpayOrderId: orderId, razorpayPaymentId: paymentId, razorpaySignature: signature } });

  const paidEvent = (o: { orderId: string; paymentId: string; amount: number; event?: string; status?: string; currency?: string }) =>
    JSON.stringify({
      event: o.event ?? "order.paid",
      payload: { payment: { entity: { id: o.paymentId, order_id: o.orderId, amount: o.amount, currency: o.currency ?? "INR", status: o.status ?? "captured" } } },
    });

  const webhook = (body: string, secret = WEBHOOK_SECRET) =>
    t.call("POST", "/api/shopkeeper/payment/webhook", { rawBody: body, headers: { "X-Razorpay-Signature": hmac(secret, body) } });

  const order = (razorpayOrderId: string) => t.prisma.paymentOrder.findUniqueOrThrow({ where: { razorpayOrderId } });
  const accounts = () => t.prisma.shopkeeper.count();

  // ── starting a payment ─────────────────────────────────────────────────────

  describe("starting a registration payment", () => {
    it("records the order, asks Razorpay for the plan's price, and shows the browser only the public key", async () => {
      const o = await orderFor("3m");
      assert.equal(o.amount, PRICE["3m"]);
      const row = await order(o.orderId);
      assert.deepEqual([row.purpose, row.planType, row.amount, row.status, row.draftId, row.shopkeeperId], ["REGISTRATION", "3m", PRICE["3m"], "CREATED", o.draftId, null]);

      assert.equal(razorpay.state.created.length, 1);
      const [sent] = razorpay.state.created;
      assert.deepEqual([sent.amount, sent.currency, sent.payment_capture, sent.receipt], [PRICE["3m"], "INR", 1, row.id]);
      assert.ok(sent.receipt.length <= 40, "Razorpay caps receipts at 40 characters");
      assert.ok(!JSON.stringify(sent.notes).includes(o.draftId), "the draft id is a bearer secret and stays out of Razorpay");

      const res = await startPayment(o.draftId, "3m");
      assert.deepEqual(Object.keys(res.json).sort(), ["amount", "currency", "keyId", "orderId"]);
      assert.equal(res.json.keyId, KEY_ID);
      assert.ok(!JSON.stringify(res.json).includes(KEY_SECRET));
    });

    it("hands the same order back for the same plan, and a new one for a different plan", async () => {
      const o = await orderFor("2m");
      const again = await startPayment(o.draftId, "2m");
      assert.equal(again.json.orderId, o.orderId);
      assert.equal(razorpay.state.created.length, 1, "no second order at Razorpay");
      assert.equal(await t.prisma.paymentOrder.count(), 1);

      const other = await startPayment(o.draftId, "1m");
      assert.notEqual(other.json.orderId, o.orderId);
      assert.equal(other.json.amount, PRICE["1m"]);
      assert.equal(await t.prisma.paymentOrder.count(), 2);
    });

    it("refuses an unknown draft, an unverified phone, an expired draft and an unknown plan", async () => {
      assert.equal((await startPayment("cl_does_not_exist")).status, 400);

      const unverified = (await t.call("POST", "/api/shopkeeper/draft/init", { body: { email: `u${Date.now()}@example.test`, password: "owner-pass-123" } })).json.draftId;
      const noPhone = await startPayment(unverified);
      assert.equal(noPhone.status, 400);
      assert.match(noPhone.json.message, /phone/i);

      const { draftId } = await draftReadyToPay();
      await t.prisma.shopkeeperDraft.update({ where: { id: draftId }, data: { expiresAt: new Date(Date.now() - 1000) } });
      assert.match((await startPayment(draftId)).json.message, /expired/i);

      assert.equal((await t.call("POST", "/api/shopkeeper/payment/create-order", { body: { draftId, planType: "12m" } })).status, 400);
      assert.equal(razorpay.state.created.length, 0, "Razorpay was never asked");
    });

    it("refuses before any money moves when the email already has an account", async () => {
      const { draftId, email } = await draftReadyToPay();
      const existing = await createShop(t.prisma);
      await t.prisma.shopkeeper.update({ where: { id: existing.shopkeeperId }, data: { email } });
      const res = await startPayment(draftId);
      assert.equal(res.status, 409);
      assert.match(res.json.message, /already exists/i);
      assert.equal(razorpay.state.created.length, 0);
    });

    it("tells someone whose registration was finished by the webhook that they are done, not that the draft vanished", async () => {
      const o = await orderFor();
      assert.equal((await webhook(paidEvent({ orderId: o.orderId, paymentId: "pay_Done1", amount: o.amount }))).status, 200);
      const res = await startPayment(o.draftId);
      assert.equal(res.status, 409);
      assert.match(res.json.message, /already complete.*log in/i);
    });

    it("reports a Razorpay outage as a retryable problem, without leaking its message or leaving a stray order", async () => {
      const { draftId } = await draftReadyToPay();
      razorpay.state.createFailure = { statusCode: 502, error: { description: "upstream says: key rzp_test_LEAK invalid" } };
      const res = await startPayment(draftId);
      assert.equal(res.status, 503);
      assert.match(res.json.message, /unavailable/i);
      assert.ok(!JSON.stringify(res.json).includes("LEAK"));
      assert.equal(await t.prisma.paymentOrder.count(), 0);

      razorpay.state.createFailure = { statusCode: 401, error: { description: "Authentication failed" } };
      assert.equal((await startPayment(draftId)).status, 502, "a rejected key will not fix itself on retry");
    });
  });

  // ── the browser confirms ───────────────────────────────────────────────────

  describe("confirming from the browser", () => {
    it("creates the account, grants the plan and records the payment", async () => {
      const o = await orderFor("3m");
      const res = await confirm(o.draftId, o.orderId, "pay_Ok1");
      assert.equal(res.status, 200, JSON.stringify(res.json));
      assert.equal((await t.call("GET", "/api/shop/me", { token: res.json.token })).status, 200, "the returned session works");

      const owner = await t.prisma.shopkeeper.findUniqueOrThrow({ where: { id: res.json.shopkeeperId } });
      assert.deepEqual([owner.planType, owner.razorpayOrderId, owner.razorpayPaymentId, owner.email], ["3m", o.orderId, "pay_Ok1", o.email]);
      const daysLeft = (owner.planExpiresAt.getTime() - Date.now()) / DAY_MS;
      assert.ok(daysLeft > 89.9 && daysLeft <= 90);

      const row = await order(o.orderId);
      assert.deepEqual([row.status, row.razorpayPaymentId, row.shopkeeperId], ["FULFILLED", "pay_Ok1", owner.id]);
      assert.ok(row.fulfilledAt);
      const ledger = await t.prisma.planPayment.findMany({ where: { shopkeeperId: owner.id } });
      assert.deepEqual(ledger.map((l) => [l.purpose, l.amount, l.razorpayPaymentId]), [["REGISTRATION", PRICE["3m"], "pay_Ok1"]]);
      assert.equal(await t.prisma.shopkeeperDraft.count({ where: { id: o.draftId } }), 0, "the draft is consumed");
    });

    it("takes the plan from our order, not from anything the browser says", async () => {
      const o = await orderFor("1m");
      const res = await t.call("POST", "/api/shopkeeper/payment/verify", {
        body: { draftId: o.draftId, planType: "3m", amount: 89_900, razorpayOrderId: o.orderId, razorpayPaymentId: "pay_Cheap1", razorpaySignature: hmac(KEY_SECRET, `${o.orderId}|pay_Cheap1`) },
      });
      assert.equal(res.status, 200);
      assert.equal((await t.prisma.shopkeeper.findUniqueOrThrow({ where: { id: res.json.shopkeeperId } })).planType, "1m");
    });

    it("rejects a forged or mismatched signature and changes nothing", async () => {
      const o = await orderFor();
      const good = hmac(KEY_SECRET, `${o.orderId}|pay_1`);
      for (const signature of ["deadbeef", good.slice(0, -1), good + "0", hmac("another-secret", `${o.orderId}|pay_1`), hmac(KEY_SECRET, `${o.orderId}|pay_2`), "not hex at all"]) {
        const res = await confirm(o.draftId, o.orderId, "pay_1", signature);
        assert.equal(res.status, 400, signature);
        assert.match(res.json.message, /verification failed/i);
      }
      assert.equal(await accounts(), 0);
      assert.equal((await order(o.orderId)).status, "CREATED");
      assert.equal(await t.prisma.shopkeeperDraft.count({ where: { id: o.draftId } }), 1);
    });

    it("rejects an order that belongs to a different registration, even with a valid signature", async () => {
      const a = await orderFor();
      const b = await draftReadyToPay();
      const res = await confirm(b.draftId, a.orderId, "pay_Stolen1");
      assert.equal(res.status, 400);
      assert.match(res.json.message, /does not belong/i);
      assert.equal(await accounts(), 0);
      assert.equal((await order(a.orderId)).status, "CREATED");
    });

    it("rejects an order this app never made", async () => {
      const { draftId } = await draftReadyToPay();
      const res = await confirm(draftId, "order_SomeoneElses", "pay_X1");
      assert.equal(res.status, 400);
    });

    it("refuses a payment id that already paid for another order", async () => {
      const a = await orderFor();
      assert.equal((await confirm(a.draftId, a.orderId, "pay_Reused")).status, 200);
      const b = await orderFor();
      const res = await confirm(b.draftId, b.orderId, "pay_Reused");
      assert.equal(res.status, 409);
      assert.match(res.json.message, /already been used/i);
      assert.equal(await accounts(), 1);
    });

    it("answers a repeat confirmation with the same account, never a second one", async () => {
      const o = await orderFor();
      const first = await confirm(o.draftId, o.orderId, "pay_Twice1");
      const second = await confirm(o.draftId, o.orderId, "pay_Twice1");
      assert.equal(second.status, 200);
      assert.equal(second.json.shopkeeperId, first.json.shopkeeperId);
      assert.equal(await accounts(), 1);
      assert.equal(await t.prisma.planPayment.count(), 1);
    });

    it("stops handing out sessions for a finished registration after a day", async () => {
      const o = await orderFor();
      assert.equal((await confirm(o.draftId, o.orderId, "pay_Old1")).status, 200);
      await t.prisma.paymentOrder.update({ where: { razorpayOrderId: o.orderId }, data: { fulfilledAt: new Date(Date.now() - 25 * 3_600_000) } });
      const res = await confirm(o.draftId, o.orderId, "pay_Old1");
      assert.equal(res.status, 409);
      assert.match(res.json.message, /log in/i);
    });

    it("creates one account when the same confirmation arrives twice at the same moment", async () => {
      const o = await orderFor();
      const results = await Promise.all([1, 2, 3].map(() => confirm(o.draftId, o.orderId, "pay_Race1")));
      assert.deepEqual(results.map((r) => r.status), [200, 200, 200]);
      assert.equal(new Set(results.map((r) => r.json.shopkeeperId)).size, 1);
      assert.equal(await accounts(), 1);
      assert.equal(await t.prisma.planPayment.count(), 1);
    });

    it("validates its input", async () => {
      const o = await orderFor();
      const base = { draftId: o.draftId, razorpayOrderId: o.orderId, razorpayPaymentId: "pay_1", razorpaySignature: "ab" };
      for (const bad of [{}, { ...base, draftId: "" }, { ...base, razorpayOrderId: "order bad!" }, { ...base, razorpayPaymentId: "x".repeat(65) }, { ...base, razorpaySignature: "" }, { ...base, razorpaySignature: "a".repeat(129) }]) {
        assert.equal((await t.call("POST", "/api/shopkeeper/payment/verify", { body: bad })).status, 400, JSON.stringify(bad).slice(0, 80));
      }
    });
  });

  // ── the webhook ────────────────────────────────────────────────────────────

  describe("the Razorpay webhook", () => {
    it("completes a registration when the browser never got to confirm, and the buyer can still log in", async () => {
      const o = await orderFor("2m");
      const res = await webhook(paidEvent({ orderId: o.orderId, paymentId: "pay_Wh1", amount: o.amount }));
      assert.equal(res.status, 200);
      assert.equal(await accounts(), 1);
      const row = await order(o.orderId);
      assert.deepEqual([row.status, row.razorpayPaymentId], ["FULFILLED", "pay_Wh1"]);

      const login = await t.call("POST", "/api/shopkeeper/login", { body: { email: o.email, password: "owner-pass-123" } });
      assert.equal(login.status, 200, "the email and password chosen at sign-up work");
    });

    it("accepts payment.captured as well as order.paid", async () => {
      const o = await orderFor();
      assert.equal((await webhook(paidEvent({ orderId: o.orderId, paymentId: "pay_Cap1", amount: o.amount, event: "payment.captured" }))).status, 200);
      assert.equal((await order(o.orderId)).status, "FULFILLED");
    });

    it("lets the browser confirm afterwards and get the same account", async () => {
      const o = await orderFor();
      await webhook(paidEvent({ orderId: o.orderId, paymentId: "pay_First1", amount: o.amount }));
      const res = await confirm(o.draftId, o.orderId, "pay_First1");
      assert.equal(res.status, 200, JSON.stringify(res.json));
      assert.equal((await t.call("GET", "/api/shop/me", { token: res.json.token })).status, 200);
      assert.equal(await accounts(), 1);
      assert.equal(await t.prisma.planPayment.count(), 1);
    });

    it("grants once when the browser and the webhook arrive together", async () => {
      const o = await orderFor();
      const [browser, hook, hookAgain] = await Promise.all([
        confirm(o.draftId, o.orderId, "pay_Both1"),
        webhook(paidEvent({ orderId: o.orderId, paymentId: "pay_Both1", amount: o.amount })),
        webhook(paidEvent({ orderId: o.orderId, paymentId: "pay_Both1", amount: o.amount, event: "payment.captured" })),
      ]);
      assert.deepEqual([browser.status, hook.status, hookAgain.status], [200, 200, 200]);
      assert.equal(await accounts(), 1);
      assert.equal(await t.prisma.planPayment.count(), 1);
      assert.equal(razorpay.state.refunds.length, 0, "nothing was refunded");
    });

    it("treats a re-delivered event as done", async () => {
      const o = await orderFor();
      const body = paidEvent({ orderId: o.orderId, paymentId: "pay_Dup1", amount: o.amount });
      assert.equal((await webhook(body)).status, 200);
      assert.equal((await webhook(body)).status, 200);
      assert.equal(await accounts(), 1);
      assert.equal(razorpay.state.refunds.length, 0);
    });

    it("refunds a second, different payment against an order that is already paid", async () => {
      const o = await orderFor();
      await webhook(paidEvent({ orderId: o.orderId, paymentId: "pay_A1", amount: o.amount }));
      const res = await webhook(paidEvent({ orderId: o.orderId, paymentId: "pay_B1", amount: o.amount }));
      assert.equal(res.status, 200);
      assert.equal(razorpay.state.refunds.length, 1);
      assert.deepEqual([razorpay.state.refunds[0].paymentId, razorpay.state.refunds[0].amount], ["pay_B1", o.amount]);
      const row = await order(o.orderId);
      assert.deepEqual([row.status, row.razorpayPaymentId], ["FULFILLED", "pay_A1"], "the first payment still owns the order");
      assert.equal(await accounts(), 1);
    });

    it("rejects an unsigned or wrongly signed delivery and changes nothing", async () => {
      const o = await orderFor();
      const body = paidEvent({ orderId: o.orderId, paymentId: "pay_Bad1", amount: o.amount });
      assert.equal((await webhook(body, "another-secret")).status, 401);
      assert.equal((await t.call("POST", "/api/shopkeeper/payment/webhook", { rawBody: body, headers: { "X-Razorpay-Signature": "short" } })).status, 401);
      assert.equal((await t.call("POST", "/api/shopkeeper/payment/webhook", { rawBody: body })).status, 400);
      assert.equal((await t.call("POST", "/api/shopkeeper/payment/webhook", { rawBody: body.replace(String(o.amount), "1"), headers: { "X-Razorpay-Signature": hmac(WEBHOOK_SECRET, body) } })).status, 401, "a tampered body fails its signature");
      assert.equal(await accounts(), 0);
      assert.equal((await order(o.orderId)).status, "CREATED");
    });

    it("answers a signed event it cannot parse with 400, not a crash", async () => {
      assert.equal((await webhook("{ not json")).status, 400);
    });

    it("never grants a payment that is not what we asked for, and does not make Razorpay retry it", async () => {
      const o = await orderFor("3m");
      const wrong: Parameters<typeof paidEvent>[0][] = [
        { orderId: o.orderId, paymentId: "pay_Low1", amount: PRICE["1m"] },
        { orderId: o.orderId, paymentId: "pay_Auth1", amount: o.amount, status: "authorized" },
        { orderId: o.orderId, paymentId: "pay_Fail1", amount: o.amount, status: "failed" },
        { orderId: o.orderId, paymentId: "pay_Usd1", amount: o.amount, currency: "USD" },
      ];
      for (const event of wrong) assert.equal((await webhook(paidEvent(event))).status, 200, event.paymentId);
      assert.equal(await accounts(), 0);
      assert.equal((await order(o.orderId)).status, "CREATED");
      assert.equal(razorpay.state.refunds.length, 0);
    });

    it("ignores orders it did not create, malformed payments and unrelated events", async () => {
      const o = await orderFor();
      const harmless = [
        paidEvent({ orderId: "order_NotOurs", paymentId: "pay_N1", amount: 100 }),
        JSON.stringify({ event: "order.paid", payload: { payment: { entity: { id: "pay_X" } } } }),
        JSON.stringify({ event: "order.paid", payload: {} }),
        JSON.stringify({ event: "subscription.charged", payload: { payment: { entity: { id: "pay_S1", order_id: o.orderId, amount: o.amount, currency: "INR", status: "captured" } } } }),
        JSON.stringify({ event: "payment.failed", payload: { payment: { entity: { id: "pay_F1", order_id: o.orderId, error_code: "BAD_REQUEST_ERROR", error_description: "bank declined" } } } }),
        JSON.stringify({ unexpected: true }),
        JSON.stringify([1, 2, 3]),
      ];
      for (const body of harmless) assert.equal((await webhook(body)).status, 200, body.slice(0, 60));
      assert.equal(await accounts(), 0);
      assert.equal((await order(o.orderId)).status, "CREATED");
    });

    it("asks Razorpay to retry when it hits a failure mid-grant, with nothing half-applied", async () => {
      const o = await orderFor();
      // A failure inside the granting transaction (here: corrupt data) after the account insert has begun.
      await t.prisma.paymentOrder.update({ where: { razorpayOrderId: o.orderId }, data: { planType: "9z" } });
      const res = await webhook(paidEvent({ orderId: o.orderId, paymentId: "pay_Retry1", amount: o.amount }));
      assert.equal(res.status, 500);
      assert.ok(!JSON.stringify(res.json).includes("9z"), "internals are not leaked");
      assert.equal((await order(o.orderId)).status, "CREATED", "the order is still open");
      assert.equal(await accounts(), 0, "no account was left behind");
      assert.equal(await t.prisma.shopkeeperDraft.count({ where: { id: o.draftId } }), 1, "the draft is intact");
      assert.equal(razorpay.state.refunds.length, 0, "an internal fault is retried, never refunded");

      await t.prisma.paymentOrder.update({ where: { razorpayOrderId: o.orderId }, data: { planType: "2m" } });
      assert.equal((await webhook(paidEvent({ orderId: o.orderId, paymentId: "pay_Retry1", amount: o.amount }))).status, 200);
      assert.equal((await order(o.orderId)).status, "FULFILLED");
      assert.equal(await accounts(), 1);
    });
  });

  // ── when a payment cannot be honoured ──────────────────────────────────────

  describe("a payment that cannot be honoured is refunded", () => {
    it("because the email got an account while the person was paying (webhook)", async () => {
      const o = await orderFor("2m");
      const existing = await createShop(t.prisma);
      await t.prisma.shopkeeper.update({ where: { id: existing.shopkeeperId }, data: { email: o.email } });

      const res = await webhook(paidEvent({ orderId: o.orderId, paymentId: "pay_Late1", amount: o.amount }));
      assert.equal(res.status, 200);
      assert.deepEqual(razorpay.state.refunds.map((r) => [r.paymentId, r.amount]), [["pay_Late1", o.amount]]);
      const row = await order(o.orderId);
      assert.deepEqual([row.status, row.razorpayRefundId, row.razorpayPaymentId], ["REFUNDED", "rfnd_Fake1", "pay_Late1"]);
      assert.match(row.failureReason ?? "", /email/i);
      assert.equal(await t.prisma.planPayment.count(), 0, "no ledger entry for a purchase that did not happen");
    });

    it("and tells the person so when they confirm from the browser", async () => {
      const o = await orderFor();
      await t.prisma.shopkeeperDraft.delete({ where: { id: o.draftId } });
      const res = await confirm(o.draftId, o.orderId, "pay_Gone1");
      assert.equal(res.status, 409);
      assert.match(res.json.message, /refunded/i);
      assert.match(res.json.message, /no longer available/i);
      assert.equal(razorpay.state.refunds.length, 1);
      assert.equal(await accounts(), 0);

      const again = await confirm(o.draftId, o.orderId, "pay_Gone1");
      assert.equal(again.status, 409);
      assert.equal(razorpay.state.refunds.length, 1, "asking again never refunds twice");
    });

    it("and keeps trying when Razorpay will not take the refund yet", async () => {
      const o = await orderFor();
      await t.prisma.shopkeeperDraft.delete({ where: { id: o.draftId } });
      razorpay.state.refundFailure = { statusCode: 500, error: { description: "refund service down" } };

      const browser = await confirm(o.draftId, o.orderId, "pay_Stuck1");
      assert.equal(browser.status, 409);
      assert.match(browser.json.message, /pay_Stuck1/, "the payment id is given so support can find it");
      assert.equal((await order(o.orderId)).status, "NEEDS_REFUND");

      const hook = await webhook(paidEvent({ orderId: o.orderId, paymentId: "pay_Stuck1", amount: o.amount }));
      assert.equal(hook.status, 503, "Razorpay is asked to deliver the event again");

      razorpay.state.refundFailure = null;
      const redelivery = await webhook(paidEvent({ orderId: o.orderId, paymentId: "pay_Stuck1", amount: o.amount }));
      assert.equal(redelivery.status, 200);
      assert.equal((await order(o.orderId)).status, "REFUNDED");
      assert.equal(razorpay.state.refunds.length, 1);
    });

    it("and the daily sweep finishes refunds nobody asked about again", async () => {
      const o = await orderFor();
      await t.prisma.shopkeeperDraft.delete({ where: { id: o.draftId } });
      razorpay.state.refundFailure = { statusCode: 500, error: { description: "down" } };
      await webhook(paidEvent({ orderId: o.orderId, paymentId: "pay_Sweep1", amount: o.amount }));
      assert.equal((await order(o.orderId)).status, "NEEDS_REFUND");

      razorpay.state.refundFailure = null;
      assert.equal(await retryPendingRefunds(), 0, "too recent: given time to resolve itself first");
      assert.equal(await retryPendingRefunds(new Date(Date.now() + 31 * 60_000)), 1);
      assert.equal((await order(o.orderId)).status, "REFUNDED");
      assert.equal(await retryPendingRefunds(new Date(Date.now() + 60 * 60_000)), 0, "nothing left to do");
    });
  });

  // ── renewals ───────────────────────────────────────────────────────────────

  describe("renewing a plan", () => {
    async function liveShop(daysLeft = 10, planType = "1m") {
      const made = await createShop(t.prisma, { planType });
      await t.prisma.shopkeeper.update({ where: { id: made.shopkeeperId }, data: { planExpiresAt: new Date(Date.now() + daysLeft * DAY_MS) } });
      return { ...made, token: t.shopkeeperToken(made.shopkeeperId) };
    }
    const renewalOrder = async (s: { token: string }, plan = "2m") => (await t.call("POST", "/api/shopkeeper/billing/order", { token: s.token, body: { planType: plan } })).json.data as { orderId: string; amount: number };
    const renewConfirm = (s: { token: string }, orderId: string, paymentId: string) =>
      t.call("POST", "/api/shopkeeper/billing/verify", { token: s.token, body: { razorpayOrderId: orderId, razorpayPaymentId: paymentId, razorpaySignature: hmac(KEY_SECRET, `${orderId}|${paymentId}`) } });
    const planEnd = async (id: string) => (await t.prisma.shopkeeper.findUniqueOrThrow({ where: { id } })).planExpiresAt.getTime();

    it("records an order for that shopkeeper and charges the plan's price", async () => {
      const s = await liveShop();
      const o = await renewalOrder(s, "3m");
      assert.equal(o.amount, PRICE["3m"]);
      const row = await order(o.orderId);
      assert.deepEqual([row.purpose, row.shopkeeperId, row.planType, row.status], ["RENEWAL", s.shopkeeperId, "3m", "CREATED"]);
      assert.equal((await renewalOrder(s, "3m")).orderId, o.orderId, "the same unpaid order is reused");
    });

    it("adds the purchased time to what is left, once, however often it is confirmed", async () => {
      const s = await liveShop(10);
      const before = await planEnd(s.shopkeeperId);
      const o = await renewalOrder(s, "2m");
      for (let i = 0; i < 3; i += 1) assert.equal((await renewConfirm(s, o.orderId, "pay_Rn1")).status, 200);
      assert.equal(await planEnd(s.shopkeeperId), before + 60 * DAY_MS, "10 days left + 60 bought, counted once");
      assert.equal(await t.prisma.planPayment.count({ where: { shopkeeperId: s.shopkeeperId } }), 1);
      assert.equal((await t.prisma.shopkeeper.findUniqueOrThrow({ where: { id: s.shopkeeperId } })).planType, "2m");
    });

    it("is completed by the webhook alone, and a later confirmation does not extend it again", async () => {
      const s = await liveShop(10);
      const before = await planEnd(s.shopkeeperId);
      const o = await renewalOrder(s, "1m");
      assert.equal((await webhook(paidEvent({ orderId: o.orderId, paymentId: "pay_RnWh1", amount: o.amount }))).status, 200);
      assert.equal(await planEnd(s.shopkeeperId), before + 30 * DAY_MS);

      const late = await renewConfirm(s, o.orderId, "pay_RnWh1");
      assert.equal(late.status, 200);
      assert.equal(late.json.data.daysLeft, 40);
      assert.equal(await planEnd(s.shopkeeperId), before + 30 * DAY_MS, "still just one extension");
    });

    it("extends once when the browser and the webhook race", async () => {
      const s = await liveShop(10);
      const before = await planEnd(s.shopkeeperId);
      const o = await renewalOrder(s, "1m");
      const results = await Promise.all([
        renewConfirm(s, o.orderId, "pay_RnRace1"),
        webhook(paidEvent({ orderId: o.orderId, paymentId: "pay_RnRace1", amount: o.amount })),
        renewConfirm(s, o.orderId, "pay_RnRace1"),
      ]);
      assert.deepEqual(results.map((r) => r.status), [200, 200, 200]);
      assert.equal(await planEnd(s.shopkeeperId), before + 30 * DAY_MS);
      assert.equal(await t.prisma.planPayment.count(), 1);
    });

    it("rejects a bad signature, and another shopkeeper's order", async () => {
      const a = await liveShop();
      const b = await liveShop();
      const before = await planEnd(a.shopkeeperId);
      const o = await renewalOrder(a, "1m");

      const forged = await t.call("POST", "/api/shopkeeper/billing/verify", { token: a.token, body: { razorpayOrderId: o.orderId, razorpayPaymentId: "pay_F1", razorpaySignature: "deadbeef" } });
      assert.equal(forged.status, 400);
      const stolen = await renewConfirm(b, o.orderId, "pay_S1");
      assert.equal(stolen.status, 400);
      assert.match(stolen.json.message, /does not belong/i);
      assert.equal(await planEnd(a.shopkeeperId), before);
      assert.equal((await order(o.orderId)).status, "CREATED");
    });

    it("cannot use a registration order to renew, or a renewal order to register", async () => {
      const s = await liveShop();
      const reg = await orderFor();
      assert.equal((await renewConfirm(s, reg.orderId, "pay_X1")).status, 400);
      const renewal = await renewalOrder(s);
      const draft = await draftReadyToPay();
      assert.equal((await confirm(draft.draftId, renewal.orderId, "pay_X2")).status, 400);
    });
  });

  // ── housekeeping ───────────────────────────────────────────────────────────

  describe("housekeeping", () => {
    const row = (suffix: string, createdDaysAgo: number, status: "CREATED" | "FULFILLED" | "NEEDS_REFUND") => ({
      id: `po_${suffix}`,
      razorpayOrderId: `order_${suffix}`,
      purpose: "REGISTRATION" as const,
      planType: "1m",
      amount: PRICE["1m"],
      status,
      draftId: `draft_${suffix}`,
      createdAt: new Date(Date.now() - createdDaysAgo * DAY_MS),
    });

    it("forgets orders nobody paid after 90 days, and nothing else", async () => {
      await t.prisma.paymentOrder.createMany({
        data: [row("oldUnpaid", 100, "CREATED"), row("newUnpaid", 10, "CREATED"), row("oldPaid", 400, "FULFILLED"), row("oldStuck", 400, "NEEDS_REFUND")],
      });
      const result = await purgeExpiredData();
      assert.equal(result.paymentOrders, 1);
      const left = (await t.prisma.paymentOrder.findMany({ select: { id: true }, orderBy: { id: "asc" } })).map((r) => r.id);
      assert.deepEqual(left, ["po_newUnpaid", "po_oldPaid", "po_oldStuck"]);
    });

    it("removes a shopkeeper's orders with their account", async () => {
      const s = await createShop(t.prisma);
      await t.prisma.paymentOrder.create({ data: { ...row("mine", 1, "FULFILLED"), shopkeeperId: s.shopkeeperId } });
      await t.prisma.shopkeeper.delete({ where: { id: s.shopkeeperId } });
      assert.equal(await t.prisma.paymentOrder.count(), 0);
    });
  });
});
