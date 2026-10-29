import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import {
  MUMBAI,
  connectTestEnvironment,
  createCustomer,
  createDesign,
  createShop,
  integrationConfigured,
  resetDatabase,
  stubSendEach,
  type TestMessaging,
  type TestPrisma,
} from "../test/integration.js";

const enabled = integrationConfigured();
const NEAR = { latitude: 19.09, longitude: 72.89 };

describe("notification HTTP API", { skip: !enabled }, () => {
  let prisma: TestPrisma;
  let messaging: TestMessaging;
  let server: Server;
  let baseUrl: string;
  let shopkeeperToken: (id: string) => string;
  let customerToken: (id: string) => string;
  let stub: ReturnType<typeof stubSendEach>;

  before(async () => {
    ({ prisma, firebaseMessaging: messaging } = await connectTestEnvironment());
    const { app } = await import("../app.js");
    const jwt = await import("../utils/jwt.js");
    shopkeeperToken = (id) => jwt.signShopkeeperToken(id, 0);
    customerToken = (id) => jwt.signCustomerToken(id, 0);
    server = createServer(app).listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    stub = stubSendEach(messaging);
  });

  afterEach(() => stub.restore());

  async function call(
    method: string,
    path: string,
    options: { token?: string; body?: unknown } = {},
  ) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  }

  async function shopWithMember(options: { planType?: string } = {}) {
    const shop = await createShop(prisma, options);
    const designId = await createDesign(prisma, shop.shopkeeperId);
    const member = await createCustomer(prisma, { member: { roomId: shop.roomId } });
    return { ...shop, designId, member, token: shopkeeperToken(shop.shopkeeperId) };
  }

  const sendBody = (designId: string, mode = "ROOM_MEMBERS", radiusKm = 10) => ({
    source: "DESIGN",
    notificationId: designId,
    audience: { mode, radiusKm },
    message: "Hello",
  });

  describe("authentication", () => {
    it("rejects shopkeeper endpoints without a shopkeeper token", async () => {
      const { designId, member } = await shopWithMember();
      const paths: [string, string][] = [
        ["POST", "/api/notifications/send"],
        ["GET", "/api/notifications/sends"],
        ["POST", "/api/notifications/schedules"],
        ["GET", "/api/notifications/schedules"],
        ["PATCH", "/api/notifications/schedules/x"],
        ["DELETE", "/api/notifications/schedules/x"],
      ];
      for (const [method, path] of paths) {
        const body = method === "GET" ? undefined : sendBody(designId);
        const anon = await call(method, path, { body });
        assert.equal(anon.status, 401, `${method} ${path} anonymous`);
        const asCustomer = await call(method, path, {
          token: customerToken(member.customerId),
          body,
        });
        assert.equal(asCustomer.status, 401, `${method} ${path} as customer`);
      }
    });

    it("rejects the customer endpoint without a customer token (and for a shopkeeper)", async () => {
      const { token } = await shopWithMember();
      assert.equal((await call("GET", "/api/notifications/sends/abc/design")).status, 401);
      assert.equal((await call("GET", "/api/notifications/sends/abc/design", { token })).status, 401);
    });
  });

  describe("POST /send", () => {
    it("sends, then reports the send in history with analytics", async () => {
      const { designId, token, member } = await shopWithMember();
      const sent = await call("POST", "/api/notifications/send", {
        token,
        body: sendBody(designId),
      });
      assert.equal(sent.status, 201);
      assert.equal(sent.json.data.recipients, 1);

      const rt = stub.messages()[0].data?.rt as string;
      assert.equal((await call("POST", "/api/notifications/receipts", { body: { token: rt, event: "CLICKED" } })).status, 204);

      const history = await call("GET", "/api/notifications/sends", { token });
      assert.equal(history.status, 200);
      const [item] = history.json.data.items;
      assert.equal(item.id, sent.json.data.id);
      assert.equal(item.designName, "Test banner");
      assert.equal(item.audience, "ROOM_MEMBERS");
      assert.deepEqual(
        [item.recipientCount, item.successCount, item.deliveredCount, item.openedCount, item.clickedCount],
        [1, 1, 1, 1, 1],
      );

      // The customer can fetch the exact design that was delivered.
      const design = await call("GET", `/api/notifications/sends/${sent.json.data.id}/design`, {
        token: customerToken(member.customerId),
      });
      assert.equal(design.status, 200);
      assert.equal(design.json.data.designJson.name, "Test banner");
    });

    it("rejects malformed bodies with a 400 and sends nothing", async () => {
      const { designId, token } = await shopWithMember();
      const bad: unknown[] = [
        {},
        { ...sendBody(designId), audience: { mode: "EVERYONE", radiusKm: 10 } },
        { ...sendBody(designId), audience: { mode: "NEARBY", radiusKm: 999 } },
        { ...sendBody(designId), audience: { mode: "NEARBY", radiusKm: 2.5 } },
        { ...sendBody(designId), message: "x".repeat(101) },
        { ...sendBody(designId), notificationId: "" },
      ];
      for (const body of bad) {
        const res = await call("POST", "/api/notifications/send", { token, body });
        assert.equal(res.status, 400, JSON.stringify(body).slice(0, 80));
      }
      assert.equal(stub.messages().length, 0);
    });

    it("returns 429 with a readable message once the daily limit is used", async () => {
      const { designId, token } = await shopWithMember({ planType: "1m" });
      assert.equal(
        (await call("POST", "/api/notifications/send", { token, body: sendBody(designId) })).status,
        201,
      );
      const second = await call("POST", "/api/notifications/send", {
        token,
        body: sendBody(designId),
      });
      assert.equal(second.status, 429);
      assert.match(second.json.message, /today's limit of 1 notification/);

      const caps = await call("GET", "/api/notifications/capabilities", { token });
      assert.equal(caps.json.data.usedToday, 1);
      assert.equal(caps.json.data.capabilities.dailyNotificationLimit, 1);
    });

    it("reaches nearby strangers when sent to NEARBY, and not those far away", async () => {
      const { designId, token } = await shopWithMember();
      const nearby = await createCustomer(prisma, { location: NEAR });
      await createCustomer(prisma, { location: { latitude: 18.52, longitude: 73.85 } });

      const res = await call("POST", "/api/notifications/send", {
        token,
        body: sendBody(designId, "NEARBY", 10),
      });
      assert.equal(res.status, 201);
      const tokens = stub.messages().map((m) => (m as { token: string }).token);
      // The room member has no location on file, so only the stranger inside the radius qualifies.
      assert.deepEqual(tokens, nearby.tokens);
    });

    it("refuses a distance audience with a helpful 400 when the shop has no location", async () => {
      const shop = await createShop(prisma, { location: null });
      const designId = await createDesign(prisma, shop.shopkeeperId);
      const res = await call("POST", "/api/notifications/send", {
        token: shopkeeperToken(shop.shopkeeperId),
        body: sendBody(designId, "MEMBERS_NEARBY"),
      });
      assert.equal(res.status, 400);
      assert.match(res.json.message, /shop location/i);
    });

    it("does not leak internals when something unexpected breaks", async () => {
      const { designId, token } = await shopWithMember();
      const res = await call("POST", "/api/notifications/send", {
        token,
        body: { ...sendBody(designId), notificationId: "no-such-design" },
      });
      assert.equal(res.status, 404);
      assert.ok(!JSON.stringify(res.json).includes("prisma"));
    });
  });

  describe("schedules", () => {
    const body = (designId: string, overrides: Record<string, unknown> = {}) => ({
      source: "DESIGN",
      notificationId: designId,
      audience: {
        includeMembers: true,
        includeNearby: false,
        radiusKm: 10,
        includeFutureMembers: true,
        skipNotificationsOff: true,
      },
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
      ...overrides,
    });

    it("creates, lists, pauses, resumes and cancels over HTTP", async () => {
      const { designId, token } = await shopWithMember();
      const created = await call("POST", "/api/notifications/schedules", {
        token,
        body: body(designId),
      });
      assert.equal(created.status, 201);
      const id = created.json.data.id as string;

      const list = await call("GET", "/api/notifications/schedules?state=upcoming", { token });
      assert.equal(list.status, 200);
      assert.equal(list.json.data.items[0].id, id);
      assert.equal(list.json.data.items[0].designJson.name, "Test banner");

      const paused = await call("PATCH", `/api/notifications/schedules/${id}`, {
        token,
        body: { status: "PAUSED" },
      });
      assert.equal(paused.json.data.status, "PAUSED");
      const resumed = await call("PATCH", `/api/notifications/schedules/${id}`, {
        token,
        body: { status: "ACTIVE" },
      });
      assert.equal(resumed.json.data.status, "ACTIVE");

      assert.equal((await call("DELETE", `/api/notifications/schedules/${id}`, { token })).status, 200);
      const done = await call("GET", "/api/notifications/schedules?state=completed", { token });
      assert.equal(done.json.data.items[0].status, "CANCELLED");
    });

    it("explains why a schedule is invalid", async () => {
      const { designId, token } = await shopWithMember();
      const weekly = body(designId);
      weekly.schedule.recurrence = "WEEKLY";
      const res = await call("POST", "/api/notifications/schedules", { token, body: weekly });
      assert.equal(res.status, 400);
      assert.match(res.json.message, /day of the week/i);

      const badZone = body(designId);
      badZone.schedule.timeZone = "Mars/Olympus";
      assert.equal((await call("POST", "/api/notifications/schedules", { token, body: badZone })).status, 400);

      const noAudience = body(designId);
      noAudience.audience.includeMembers = false;
      assert.equal((await call("POST", "/api/notifications/schedules", { token, body: noAudience })).status, 400);

      const mutedOverride = body(designId);
      (mutedOverride.audience as Record<string, unknown>).skipNotificationsOff = false;
      assert.equal((await call("POST", "/api/notifications/schedules", { token, body: mutedOverride })).status, 400);
    });

    it("keeps one shop's schedules invisible to another", async () => {
      const a = await shopWithMember();
      const b = await shopWithMember();
      const created = await call("POST", "/api/notifications/schedules", {
        token: a.token,
        body: body(a.designId),
      });
      const id = created.json.data.id as string;
      assert.equal((await call("GET", "/api/notifications/schedules", { token: b.token })).json.data.total, 0);
      assert.equal((await call("PATCH", `/api/notifications/schedules/${id}`, { token: b.token, body: { status: "PAUSED" } })).status, 404);
      assert.equal((await call("DELETE", `/api/notifications/schedules/${id}`, { token: b.token })).status, 404);
    });
  });

  describe("rate limits", () => {
    it("throttles sending, and managing schedules never eats into the send allowance", async () => {
      const shop = await shopWithMember();
      const other = await shopWithMember();
      let throttled: { status: number; json: { message: string } } | null = null;
      // Invalid bodies are rejected with 400 but still count against the window.
      for (let i = 0; i < 25 && !throttled; i += 1) {
        const res = await call("POST", "/api/notifications/send", { token: shop.token, body: {} });
        if (res.status === 429) throttled = res;
      }
      assert.ok(throttled, "sending was never throttled");
      assert.match(throttled.json.message, /Too many sends/);

      // Same shopkeeper, different bucket: schedule management still answers.
      const list = await call("GET", "/api/notifications/schedules", { token: shop.token });
      assert.equal(list.status, 200);
      const patch = await call("PATCH", "/api/notifications/schedules/none", {
        token: shop.token,
        body: { status: "PAUSED" },
      });
      assert.equal(patch.status, 404, "reaches the handler instead of being throttled");

      // And one shop being throttled does not affect another.
      const unaffected = await call("POST", "/api/notifications/send", { token: other.token, body: {} });
      assert.equal(unaffected.status, 400);
    });
  });

  describe("POST /receipts", () => {
    it("needs no login but validates its input and never reveals unknown tokens", async () => {
      assert.equal((await call("POST", "/api/notifications/receipts", { body: {} })).status, 400);
      assert.equal(
        (await call("POST", "/api/notifications/receipts", { body: { token: "nope", event: "CLICKED" } })).status,
        400,
      );
      assert.equal(
        (await call("POST", "/api/notifications/receipts", { body: { token: crypto.randomUUID(), event: "CLICKED" } })).status,
        204,
      );
      assert.equal(
        (await call("POST", "/api/notifications/receipts", { body: { token: crypto.randomUUID(), event: "BOUGHT" } })).status,
        400,
      );
    });
  });

  describe("PUT /api/customers/me/location", () => {
    it("stores a position only for customers who allowed location access", async () => {
      const denied = await createCustomer(prisma, { allowLocation: false });
      const allowed = await createCustomer(prisma, { allowLocation: true });

      const forbidden = await call("PUT", "/api/customers/me/location", {
        token: customerToken(denied.customerId),
        body: MUMBAI,
      });
      assert.equal(forbidden.status, 403);
      assert.equal(
        (await prisma.customer.findUniqueOrThrow({ where: { id: denied.customerId } })).latitude,
        null,
      );

      const ok = await call("PUT", "/api/customers/me/location", {
        token: customerToken(allowed.customerId),
        body: MUMBAI,
      });
      assert.equal(ok.status, 200);
      const row = await prisma.customer.findUniqueOrThrow({ where: { id: allowed.customerId } });
      assert.equal(row.latitude, MUMBAI.latitude);
      assert.ok(row.locationUpdatedAt && Date.now() - row.locationUpdatedAt.getTime() < 10_000);
    });

    it("validates coordinates and requires a login", async () => {
      const c = await createCustomer(prisma, { allowLocation: true });
      const token = customerToken(c.customerId);
      for (const bad of [{ latitude: 91, longitude: 0 }, { latitude: 0, longitude: 181 }, { latitude: "1", longitude: 2 }, {}]) {
        assert.equal((await call("PUT", "/api/customers/me/location", { token, body: bad })).status, 400);
      }
      assert.equal((await call("PUT", "/api/customers/me/location", { body: MUMBAI })).status, 401);
    });

    it("erases the stored position when location access is switched off", async () => {
      const c = await createCustomer(prisma, { location: NEAR });
      const res = await call("PATCH", "/api/customers/me", {
        token: customerToken(c.customerId),
        body: { allowLocationAccess: false },
      });
      assert.equal(res.status, 200);
      const row = await prisma.customer.findUniqueOrThrow({ where: { id: c.customerId } });
      assert.deepEqual([row.latitude, row.longitude, row.locationUpdatedAt], [null, null, null]);
    });
  });
});
