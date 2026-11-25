import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { createCustomer, createShop, integrationConfigured, resetDatabase } from "../test/integration.js";
import { startTestApp, type TestApp } from "../test/http.js";
import { hashPassword } from "../utils/password.js";
import { describeUserAgent } from "../utils/describeUserAgent.js";

const enabled = integrationConfigured();
const PASSWORD = "owner-pass-123";
const CHROME_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

describe("describeUserAgent", () => {
  it("names the browser and system, and copes with nothing", () => {
    assert.equal(describeUserAgent(CHROME_WINDOWS), "Chrome on Windows");
    assert.equal(describeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"), "Safari on iOS");
    assert.equal(describeUserAgent("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130 Safari/537.36 Edg/130"), "Edge on Windows");
    assert.equal(describeUserAgent("Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0"), "Firefox on Linux");
    assert.equal(describeUserAgent(null), "Unknown device");
    assert.equal(describeUserAgent("curl/8.0"), "Unknown device");
  });
});

describe("security events", { skip: !enabled }, () => {
  let t: TestApp;

  before(async () => {
    t = await startTestApp();
  });
  after(() => t.close());
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await t.prisma.securityEvent.deleteMany();
    t.clearSessionCache();
    t.newClientIp();
  });

  async function customer() {
    const fixture = await createCustomer(t.prisma);
    const row = await t.prisma.customer.update({ where: { id: fixture.customerId }, data: { passwordHash: await hashPassword(PASSWORD) }, select: { email: true } });
    return { id: fixture.customerId, email: row.email, token: t.customerToken(fixture.customerId) };
  }
  async function shopkeeper() {
    const shop = await createShop(t.prisma);
    const row = await t.prisma.shopkeeper.update({ where: { id: shop.shopkeeperId }, data: { passwordHash: await hashPassword(PASSWORD) }, select: { email: true } });
    return { id: shop.shopkeeperId, email: row.email, token: t.shopkeeperToken(shop.shopkeeperId) };
  }
  /** Events are written in the background; wait for them to land. */
  async function events(actorId: string, count: number) {
    for (let i = 0; i < 100; i += 1) {
      const rows = await t.prisma.securityEvent.findMany({ where: { actorId }, orderBy: { createdAt: "asc" } });
      if (rows.length >= count) return rows;
      await new Promise((r) => setTimeout(r, 20));
    }
    return t.prisma.securityEvent.findMany({ where: { actorId }, orderBy: { createdAt: "asc" } });
  }
  const login = (email: string, password: string, ua = CHROME_WINDOWS) => t.call("POST", "/api/customers/login", { body: { email, password }, headers: { "User-Agent": ua } });

  it("records a customer's sign-ins and failed attempts against their account, with the device", async () => {
    const c = await customer();
    assert.equal((await login(c.email, "wrong-password-1")).status, 401);
    assert.equal((await login(c.email, PASSWORD)).status, 200);

    const rows = await events(c.id, 2);
    assert.deepEqual(rows.map((r) => r.type), ["LOGIN_FAILED", "LOGIN_SUCCESS"]);
    assert.equal(rows[1].actorRole, "CUSTOMER");
    assert.deepEqual(rows[1].detail, { method: "password" });
    assert.match(rows[1].userAgent ?? "", /Chrome/);
    assert.ok(rows[1].ip);
  });

  it("records a failed attempt on an address with no account without inventing an owner", async () => {
    assert.equal((await login("nobody@example.test", "whatever-123")).status, 401);
    for (let i = 0; i < 100 && (await t.prisma.securityEvent.count()) === 0; i += 1) await new Promise((r) => setTimeout(r, 20));
    const rows = await t.prisma.securityEvent.findMany();
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].type, rows[0].actorId], ["LOGIN_FAILED", null]);
    assert.ok(!JSON.stringify(rows[0]).includes("nobody@example.test"), "the address that was tried is not stored");
  });

  it("records a shopkeeper's sign-in", async () => {
    const s = await shopkeeper();
    assert.equal((await t.call("POST", "/api/shopkeeper/login", { body: { email: s.email, password: PASSWORD } })).status, 200);
    assert.equal((await t.call("POST", "/api/shopkeeper/login", { body: { email: s.email, password: "nope-nope-1" } })).status, 401);
    const rows = await events(s.id, 2);
    assert.deepEqual(rows.map((r) => [r.type, r.actorRole]), [["LOGIN_SUCCESS", "SHOPKEEPER"], ["LOGIN_FAILED", "SHOPKEEPER"]]);
  });

  it("records password changes, resets, signing out everywhere, downloads and failed confirmations", async () => {
    const c = await customer();
    assert.equal((await t.call("PATCH", "/api/customers/me/password", { token: c.token, body: { currentPassword: "wrong-password-1", newPassword: "brand-new-pass-9" } })).status, 403);
    const changed = await t.call("PATCH", "/api/customers/me/password", { token: c.token, body: { currentPassword: PASSWORD, newPassword: "brand-new-pass-9" } });
    assert.equal(changed.status, 200, JSON.stringify(changed.json));
    const token = changed.json.token as string;

    assert.equal((await t.call("POST", "/api/customers/me/export", { token, body: { password: "still-wrong-1" } })).status, 403);
    assert.equal((await t.call("POST", "/api/customers/me/export", { token, body: { password: "brand-new-pass-9" } })).status, 200);
    assert.equal((await t.call("POST", "/api/customers/me/logout-all", { token })).status, 200);

    // A reset link, built the way the app builds one: only its hash is stored.
    const resetToken = "reset-token-for-the-test-0123456789";
    await t.prisma.passwordResetToken.create({
      data: { role: "CUSTOMER", accountId: c.id, tokenHash: createHash("sha256").update(resetToken).digest("hex"), expiresAt: new Date(Date.now() + 600_000) },
    });
    assert.equal((await t.call("POST", "/api/customers/reset-password", { body: { token: resetToken, password: "another-pass-77" } })).status, 200);

    const rows = await events(c.id, 6);
    assert.deepEqual(
      rows.map((r) => r.type).sort(),
      ["DATA_EXPORTED", "PASSWORD_CHANGED", "PASSWORD_RESET", "REAUTH_FAILED", "REAUTH_FAILED", "SESSIONS_REVOKED"].sort(),
    );
    const everything = JSON.stringify(rows);
    for (const secret of [PASSWORD, "brand-new-pass-9", "another-pass-77", "wrong-password-1", resetToken, token]) assert.ok(!everything.includes(secret), "no secret ends up in the log");
  });

  it("shows an account owner their own recent activity, and nobody else's", async () => {
    const mine = await customer();
    const other = await customer();
    await login(mine.email, PASSWORD);
    await login(other.email, PASSWORD);
    await events(mine.id, 1);
    await events(other.id, 1);

    const res = await t.call("GET", "/api/customers/me/security-events", { token: mine.token });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.length, 1);
    assert.deepEqual([res.json.data[0].type, res.json.data[0].device], ["LOGIN_SUCCESS", "Chrome on Windows"]);
    assert.equal((await t.call("GET", "/api/customers/me/security-events")).status, 401);

    const s = await shopkeeper();
    const shopView = await t.call("GET", "/api/shopkeeper/me/security-events", { token: s.token });
    assert.equal(shopView.status, 200);
    assert.deepEqual(shopView.json.data, [], "a shopkeeper does not see a customer's history");
    assert.equal((await t.call("GET", "/api/shopkeeper/me/security-events", { token: mine.token })).status, 401);
  });

  it("erases an account's history when the account is deleted", async () => {
    const c = await customer();
    await login(c.email, PASSWORD);
    await events(c.id, 1);
    assert.equal((await t.call("DELETE", "/api/customers/me", { token: c.token, body: { password: PASSWORD } })).status, 200);
    assert.equal(await t.prisma.securityEvent.count({ where: { actorId: c.id } }), 0);

    const s = await shopkeeper();
    await t.call("POST", "/api/shopkeeper/login", { body: { email: s.email, password: PASSWORD } });
    await events(s.id, 1);
    assert.equal((await t.call("DELETE", "/api/shopkeeper/me", { token: s.token, body: { password: PASSWORD } })).status, 200);
    // The deletion itself is not logged afterwards either: nothing about this person is left behind.
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(await t.prisma.securityEvent.count({ where: { actorId: s.id } }), 0);
  });

  it("is purged after a year, and only then", async () => {
    const { purgeExpiredData } = await import("../services/dataRetention.service.js");
    const c = await customer();
    const day = 86_400_000;
    await t.prisma.securityEvent.createMany({
      data: [
        { type: "LOGIN_SUCCESS", actorRole: "CUSTOMER", actorId: c.id, createdAt: new Date(Date.now() - 400 * day) },
        { type: "LOGIN_SUCCESS", actorRole: "CUSTOMER", actorId: c.id, createdAt: new Date(Date.now() - 300 * day) },
      ],
    });
    const result = await purgeExpiredData();
    assert.equal(result.securityEvents, 1);
    assert.equal(await t.prisma.securityEvent.count(), 1);
  });
});
