import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import type { Router } from "express";
import { createCustomer, createDesign, createShop, integrationConfigured, resetDatabase } from "../test/integration.js";
import { startTestApp, type TestApp } from "../test/http.js";

const enabled = integrationConfigured();

/**
 * Every route that is intentionally reachable without a session. Anything not
 * listed here must answer 401 to an anonymous caller; adding a route means
 * adding it here on purpose, with a reason.
 */
const PUBLIC_ROUTES = new Set([
  // sign-up and sign-in
  "POST /api/customers/register",
  "POST /api/customers/login",
  "POST /api/customers/google-auth",
  "POST /api/shopkeeper/login",
  // forgot / reset password: the whole point is that the caller cannot sign in
  "POST /api/customers/forgot-password",
  "POST /api/customers/reset-password",
  "POST /api/shopkeeper/forgot-password",
  "POST /api/shopkeeper/reset-password",
  // email OTP (before an account exists)
  "POST /api/otp/send",
  "POST /api/otp/verify",
  // shopkeeper onboarding is keyed by the unguessable draft id and rate limited
  "POST /api/shopkeeper/draft/init",
  "PUT /api/shopkeeper/draft/:draftId",
  "POST /api/shopkeeper/validate-phone",
  "POST /api/shopkeeper/phone/send-otp",
  "POST /api/shopkeeper/phone/verify-otp",
  "POST /api/shopkeeper/payment/create-order",
  "POST /api/shopkeeper/payment/verify",
  "POST /api/shopkeeper/upload-logo",
  // authenticated by HMAC signature instead of a session
  "POST /api/shopkeeper/payment/webhook",
  // shown to anyone following an invite link
  "GET /api/shop/invite/:code",
  // authenticated by a per-device secret token
  "POST /api/notifications/receipts",
  // public site forms: bounded input, rate limited, nothing about any account is revealed
  "POST /api/public/contact",
  "POST /api/public/newsletter",
  // monitors and error intake: no user data, bounded and rate limited
  "GET /healthz",
  "GET /readyz",
  "POST /api/client-errors/",
]);

function listRoutes(prefix: string, router: Router): { method: string; path: string }[] {
  const routes: { method: string; path: string }[] = [];
  for (const layer of router.stack) {
    const route = (layer as { route?: { path: string; methods: Record<string, boolean> } }).route;
    if (!route) continue;
    for (const method of Object.keys(route.methods)) {
      routes.push({ method: method.toUpperCase(), path: `${prefix}${route.path}` });
    }
  }
  return routes;
}

describe("HTTP security", { skip: !enabled }, () => {
  let t: TestApp;

  before(async () => {
    t = await startTestApp();
  });
  after(() => t.close());
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    t.clearSessionCache();
    t.newClientIp();
  });
  afterEach(() => {
    delete process.env.CORS_ORIGINS;
  });

  async function registerCustomer(email = `c${Date.now()}${Math.random().toString(36).slice(2, 6)}@example.test`) {
    const res = await t.call("POST", "/api/customers/register", {
      body: { fullName: "Test Customer", email, password: "correct-horse-1" },
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    return { email, token: res.json.token as string, id: res.json.cusomer.id as string };
  }

  describe("response headers and transport", () => {
    it("sends hardening headers and hides the framework", async () => {
      const res = await t.call("GET", "/api/customers/me");
      assert.equal(res.headers.get("x-content-type-options"), "nosniff");
      assert.equal(res.headers.get("referrer-policy"), "no-referrer");
      assert.equal(res.headers.get("x-frame-options"), "DENY");
      assert.match(res.headers.get("content-security-policy") ?? "", /default-src 'none'/);
      assert.match(res.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
      assert.equal(res.headers.get("cache-control"), "no-store");
      assert.equal(res.headers.get("x-powered-by"), null);
    });

    it("sends HSTS only in production", async () => {
      assert.equal((await t.call("GET", "/api/customers/me")).headers.get("strict-transport-security"), null);
      const previous = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      try {
        const res = await t.call("GET", "/api/customers/me");
        assert.match(res.headers.get("strict-transport-security") ?? "", /max-age=31536000/);
      } finally {
        if (previous === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previous;
      }
    });

    it("answers unknown routes and malformed or oversized bodies without internals", async () => {
      const missing = await t.call("GET", "/api/nope");
      assert.equal(missing.status, 404);
      assert.deepEqual(missing.json, { message: "Not found" });

      const malformed = await t.call("POST", "/api/customers/login", { rawBody: "{not json" });
      assert.equal(malformed.status, 400);
      assert.deepEqual(malformed.json, { message: "Malformed request body" });

      const huge = await t.call("POST", "/api/customers/login", {
        rawBody: JSON.stringify({ email: "a@b.co", password: "x".repeat(200_000) }),
      });
      assert.equal(huge.status, 413);
    });

    it("only lets configured origins read responses", async () => {
      process.env.CORS_ORIGINS = "https://app.shoproom.example";
      const allowed = await t.call("GET", "/api/customers/me", {
        headers: { Origin: "https://app.shoproom.example" },
      });
      assert.equal(allowed.headers.get("access-control-allow-origin"), "https://app.shoproom.example");

      const denied = await t.call("GET", "/api/customers/me", { headers: { Origin: "https://evil.example" } });
      assert.equal(denied.headers.get("access-control-allow-origin"), null);

      const preflight = await t.call("OPTIONS", "/api/customers/me", {
        headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "GET" },
      });
      assert.equal(preflight.headers.get("access-control-allow-origin"), null);
    });
  });

  describe("sign-in", () => {
    it("treats an unknown email and a wrong password identically", async () => {
      const { email } = await registerCustomer();
      const wrongPassword = await t.call("POST", "/api/customers/login", { body: { email, password: "nope-nope-1" } });
      const unknownEmail = await t.call("POST", "/api/customers/login", {
        body: { email: "ghost@example.test", password: "nope-nope-1" },
      });
      assert.equal(wrongPassword.status, 401);
      assert.equal(unknownEmail.status, 401);
      assert.deepEqual(wrongPassword.json, unknownEmail.json);
    });

    it("throttles repeated guesses against one account", async () => {
      const { email } = await registerCustomer();
      const ip = "172.16.9.9";
      const statuses: number[] = [];
      for (let i = 0; i < 10; i += 1) {
        statuses.push((await t.call("POST", "/api/customers/login", { ip, body: { email, password: `wrong-${i}-pass` } })).status);
      }
      assert.deepEqual(statuses.slice(0, 8), Array(8).fill(401));
      assert.deepEqual(statuses.slice(8), [429, 429]);
      // Even the right password is refused while throttled.
      const right = await t.call("POST", "/api/customers/login", { ip, body: { email, password: "correct-horse-1" } });
      assert.equal(right.status, 429);
    });

    it("rejects new passwords bcrypt would silently truncate", async () => {
      const res = await t.call("POST", "/api/customers/register", {
        body: { fullName: "Long Pass", email: "long@example.test", password: "a".repeat(73) },
      });
      assert.equal(res.status, 400);
    });

    it("upgrades an old, cheaper password hash on login", async () => {
      const { email } = await registerCustomer();
      const bcrypt = (await import("bcrypt")).default;
      await t.prisma.customer.update({
        where: { email },
        data: { passwordHash: await bcrypt.hash("correct-horse-1", 10) },
      });
      const login = await t.call("POST", "/api/customers/login", { body: { email, password: "correct-horse-1" } });
      assert.equal(login.status, 200);
      const stored = await t.prisma.customer.findUniqueOrThrow({ where: { email }, select: { passwordHash: true } });
      assert.equal(bcrypt.getRounds(stored.passwordHash!), 12);
    });
  });

  describe("sessions", () => {
    it("rejects tokens from one role on the other role's endpoints", async () => {
      const { token: customerToken } = await registerCustomer();
      const shop = await createShop(t.prisma);
      const shopToken = t.shopkeeperToken(shop.shopkeeperId);

      assert.equal((await t.call("GET", "/api/shop/me", { token: customerToken })).status, 401);
      assert.equal((await t.call("GET", "/api/notifications/designs", { token: customerToken })).status, 401);
      assert.equal((await t.call("GET", "/api/customers/me", { token: shopToken })).status, 401);
      assert.equal((await t.call("GET", "/api/customers/me/rooms", { token: shopToken })).status, 401);
    });

    it("signs out everywhere: older tokens stop working, new logins do", async () => {
      const { email, token } = await registerCustomer();
      assert.equal((await t.call("GET", "/api/customers/me", { token })).status, 200);

      assert.equal((await t.call("POST", "/api/customers/me/logout-all", { token })).status, 200);
      assert.equal((await t.call("GET", "/api/customers/me", { token })).status, 401);

      const login = await t.call("POST", "/api/customers/login", { body: { email, password: "correct-horse-1" } });
      assert.equal(login.status, 200);
      assert.equal((await t.call("GET", "/api/customers/me", { token: login.json.token })).status, 200);
    });

    it("signs a shopkeeper out everywhere too", async () => {
      const shop = await createShop(t.prisma);
      const token = t.shopkeeperToken(shop.shopkeeperId);
      assert.equal((await t.call("GET", "/api/shop/me", { token })).status, 200);
      assert.equal((await t.call("POST", "/api/shopkeeper/logout-all", { token })).status, 200);
      assert.equal((await t.call("GET", "/api/shop/me", { token })).status, 401);
      assert.equal((await t.call("GET", "/api/shop/me", { token: t.shopkeeperToken(shop.shopkeeperId, 1) })).status, 200);
    });

    it("stops honouring a token once its account is gone", async () => {
      const { id, token } = await registerCustomer();
      await t.prisma.customer.delete({ where: { id } });
      t.clearSessionCache();
      assert.equal((await t.call("GET", "/api/customers/me", { token })).status, 401);
    });

    it("rejects garbage and unsigned bearer tokens", async () => {
      for (const token of ["garbage", "a.b.c", "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0."]) {
        assert.equal((await t.call("GET", "/api/customers/me", { token })).status, 401);
      }
    });
  });

  describe("authorization coverage", () => {
    it("requires a session on every route that is not explicitly public", async () => {
      const found = t.routeMounts.flatMap(({ prefix, router }) => listRoutes(prefix, router));
      assert.ok(found.length > 40, `expected to discover the whole API, found ${found.length}`);

      const unexpected: string[] = [];
      for (const { method, path } of found) {
        if (PUBLIC_ROUTES.has(`${method} ${path}`)) continue;
        const url = path.replace(/:\w+/g, "x");
        const res = await t.call(method, url, { body: method === "GET" || method === "DELETE" ? undefined : {} });
        if (res.status !== 401) unexpected.push(`${method} ${path} -> ${res.status}`);
      }
      assert.deepEqual(unexpected, [], "routes reachable without a session");
    });

    it("keeps the public allow-list free of stale entries", () => {
      const found = new Set(
        t.routeMounts.flatMap(({ prefix, router }) =>
          listRoutes(prefix, router).map(({ method, path }) => `${method} ${path}`),
        ),
      );
      const stale = [...PUBLIC_ROUTES].filter((route) => !found.has(route));
      assert.deepEqual(stale, []);
    });
  });

  describe("tenant isolation", () => {
    it("keeps a room's chat and member list from non-members and other shopkeepers", async () => {
      const a = await createShop(t.prisma);
      const b = await createShop(t.prisma);
      const member = await createCustomer(t.prisma, { member: { roomId: a.roomId } });
      const outsider = await createCustomer(t.prisma);
      const room = `/api/rooms/${a.roomId}`;

      const asMember = t.customerToken(member.customerId);
      assert.equal((await t.call("GET", `${room}/messages`, { token: asMember })).status, 200);

      const intruders = [t.customerToken(outsider.customerId), t.shopkeeperToken(b.shopkeeperId)];
      for (const token of intruders) {
        for (const [method, path, body] of [
          ["GET", room, undefined],
          ["GET", `${room}/messages`, undefined],
          ["GET", `${room}/members`, undefined],
          ["POST", `${room}/messages`, { text: "hi" }],
        ] as const) {
          const res = await t.call(method, path, { token, body });
          assert.ok([403, 404].includes(res.status), `${method} ${path} -> ${res.status}`);
        }
      }
      const rows = await t.prisma.message.count({ where: { roomId: a.roomId } });
      assert.equal(rows, 0, "an outsider's message must not be stored");
    });

    it("does not let one shopkeeper read or change another's designs and schedules", async () => {
      const a = await createShop(t.prisma);
      const b = await createShop(t.prisma);
      const design = await createDesign(t.prisma, a.shopkeeperId);
      const asB = t.shopkeeperToken(b.shopkeeperId);
      const asA = t.shopkeeperToken(a.shopkeeperId);

      assert.equal((await t.call("GET", `/api/notifications/designs/${design}`, { token: asA })).status, 200);
      for (const [method, path, body] of [
        ["GET", `/api/notifications/designs/${design}`, undefined],
        ["PATCH", `/api/notifications/designs/${design}`, { name: "hijacked" }],
        ["POST", `/api/notifications/designs/${design}/duplicate`, {}],
        ["POST", `/api/notifications/designs/${design}/archive`, {}],
        ["POST", `/api/notifications/send`, {
          source: "DESIGN",
          notificationId: design,
          audience: { mode: "ROOM_MEMBERS", radiusKm: 5 },
        }],
      ] as const) {
        const res = await t.call(method, path, { token: asB, body });
        assert.ok([400, 403, 404].includes(res.status), `${method} ${path} -> ${res.status}`);
      }
      const untouched = await t.prisma.notificationDesign.findUniqueOrThrow({ where: { id: design } });
      assert.equal(untouched.name, "Test banner");
      assert.equal(untouched.status, "DRAFT");
      assert.equal(await t.prisma.notificationSend.count(), 0);

      const created = await t.call("POST", "/api/notifications/schedules", {
        token: asA,
        body: {
          source: "DESIGN",
          notificationId: design,
          audience: {
            includeMembers: true,
            includeNearby: false,
            radiusKm: 5,
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
        },
      });
      assert.equal(created.status, 201, JSON.stringify(created.json));
      {
        const id = created.json.data.id as string;
        assert.equal((await t.call("PATCH", `/api/notifications/schedules/${id}`, { token: asB, body: { status: "PAUSED" } })).status, 404);
        assert.equal((await t.call("DELETE", `/api/notifications/schedules/${id}`, { token: asB })).status, 404);
        const row = await t.prisma.notificationSchedule.findUniqueOrThrow({ where: { id } });
        assert.equal(row.status, "ACTIVE");
      }
    });
  });
});
