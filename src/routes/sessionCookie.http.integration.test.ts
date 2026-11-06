import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createCustomer, createShop, integrationConfigured, resetDatabase } from "../test/integration.js";
import { startTestApp, type TestApp } from "../test/http.js";
import { hashPassword } from "../utils/password.js";
import { stepAt, totpForStep } from "../utils/totp.js";

const enabled = integrationConfigured();
const PASSWORD = "owner-pass-123";
const APP = "https://app.example.test";
const COOKIE_MODE = { "X-Session-Mode": "cookie" };

describe("browser sessions in HttpOnly cookies", { skip: !enabled }, () => {
  let t: TestApp;
  const saved: Record<string, string | undefined> = {};
  const ENV = ["CORS_ORIGINS", "COOKIE_DOMAIN", "COOKIE_SAMESITE", "NODE_ENV"];

  before(async () => {
    for (const name of ENV) saved[name] = process.env[name];
    t = await startTestApp();
  });
  after(async () => {
    for (const name of ENV) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await t.prisma.mfaCredential.deleteMany();
    t.clearSessionCache();
    t.newClientIp();
    for (const name of ENV) delete process.env[name];
  });

  async function customer() {
    const fixture = await createCustomer(t.prisma);
    const row = await t.prisma.customer.update({ where: { id: fixture.customerId }, data: { passwordHash: await hashPassword(PASSWORD) }, select: { email: true } });
    return { id: fixture.customerId, email: row.email };
  }
  async function shopkeeper() {
    const shop = await createShop(t.prisma);
    const row = await t.prisma.shopkeeper.update({ where: { id: shop.shopkeeperId }, data: { passwordHash: await hashPassword(PASSWORD) }, select: { email: true } });
    return { id: shop.shopkeeperId, email: row.email };
  }

  const setCookies = (headers: Headers) => headers.getSetCookie();
  const sessionCookie = (headers: Headers, name: string) => setCookies(headers).find((c) => c.startsWith(`${name}=`));
  const valueOf = (cookie: string) => cookie.split(";")[0].split("=").slice(1).join("=");
  const cookieLogin = (email: string) => t.call("POST", "/api/customers/login", { body: { email, password: PASSWORD }, headers: COOKIE_MODE });
  const withCookie = (name: string, value: string, headers: Record<string, string> = {}) => ({ headers: { Cookie: `${name}=${value}`, ...headers } });

  describe("signing in", () => {
    it("puts the session in an HttpOnly cookie, keeps it out of the body, and the cookie authenticates", async () => {
      const c = await customer();
      const res = await cookieLogin(c.email);
      assert.equal(res.status, 200, JSON.stringify(res.json));
      assert.equal(res.json.token, undefined, "the token is not in the response body");
      assert.equal(res.json.customerId, c.id, "the page is told who signed in (an id is not a secret)");

      const cookie = sessionCookie(res.headers, "sr_customer");
      assert.ok(cookie, "a session cookie is set");
      for (const attribute of ["HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=604800"]) assert.ok(cookie.includes(attribute), `${attribute} in ${cookie}`);
      assert.ok(!cookie.includes("Secure"), "plain http in development and tests");
      assert.ok(!cookie.includes("Domain="));

      const me = await t.call("GET", "/api/customers/me", withCookie("sr_customer", valueOf(cookie)));
      assert.equal(me.status, 200, JSON.stringify(me.json));
    });

    it("keeps working exactly as before for anything that does not ask for a cookie", async () => {
      const c = await customer();
      const res = await t.call("POST", "/api/customers/login", { body: { email: c.email, password: PASSWORD } });
      assert.equal(typeof res.json.token, "string");
      assert.deepEqual(setCookies(res.headers), [], "no cookie is set");
      assert.equal((await t.call("GET", "/api/customers/me", { token: res.json.token })).status, 200);
    });

    it("does the same for a shopkeeper, with the shop's details still in the body", async () => {
      const s = await shopkeeper();
      const res = await t.call("POST", "/api/shopkeeper/login", { body: { email: s.email, password: PASSWORD }, headers: COOKIE_MODE });
      assert.equal(res.status, 200);
      assert.deepEqual([res.json.token, res.json.shopkeeperId], [undefined, s.id]);
      const cookie = sessionCookie(res.headers, "sr_shopkeeper");
      assert.ok(cookie?.includes("HttpOnly"));
      assert.equal((await t.call("GET", "/api/shopkeeper/billing", withCookie("sr_shopkeeper", valueOf(cookie!)))).status, 200);
    });

    it("sets a cookie when a customer registers", async () => {
      const res = await t.call("POST", "/api/customers/register", { body: { fullName: "Asha Rao", email: `new-${Date.now()}@example.test`, password: PASSWORD }, headers: COOKIE_MODE });
      assert.equal(res.status, 200, JSON.stringify(res.json));
      assert.equal(res.json.token, undefined);
      assert.ok(sessionCookie(res.headers, "sr_customer"));
    });

    it("sets the cookie only after the second step when two-step verification is on", async () => {
      const c = await customer();
      const session = await t.call("POST", "/api/customers/login", { body: { email: c.email, password: PASSWORD } });
      const token = session.json.token as string;
      const setup = await t.call("POST", "/api/customers/me/mfa/setup", { token, body: { password: PASSWORD } });
      const secret = setup.json.data.secret as string;
      await t.call("POST", "/api/customers/me/mfa/enable", { token, body: { code: totpForStep(secret, stepAt(Date.now())) } });

      const first = await cookieLogin(c.email);
      assert.equal(first.json.mfaRequired, true);
      assert.deepEqual(setCookies(first.headers), [], "the password step alone gives no session");

      const second = await t.call("POST", "/api/customers/login/mfa", { body: { mfaToken: first.json.mfaToken, code: totpForStep(secret, stepAt(Date.now()) + 1) }, headers: COOKIE_MODE });
      assert.equal(second.status, 200, JSON.stringify(second.json));
      assert.equal(second.json.token, undefined);
      assert.ok(sessionCookie(second.headers, "sr_customer"));
    });
  });

  describe("what the cookie is and is not trusted for", () => {
    it("is checked like a token: a tampered one, or one from the other role, gets nothing", async () => {
      const c = await customer();
      const s = await shopkeeper();
      const customerCookie = valueOf(sessionCookie((await cookieLogin(c.email)).headers, "sr_customer")!);
      const shopCookie = valueOf(sessionCookie((await t.call("POST", "/api/shopkeeper/login", { body: { email: s.email, password: PASSWORD }, headers: COOKIE_MODE })).headers, "sr_shopkeeper")!);

      assert.equal((await t.call("GET", "/api/customers/me", withCookie("sr_customer", customerCookie.replace(/.$/, "A")))).status, 401);
      assert.equal((await t.call("GET", "/api/customers/me", withCookie("sr_customer", shopCookie))).status, 401, "a shopkeeper's token in the customer cookie");
      assert.equal((await t.call("GET", "/api/shopkeeper/billing", withCookie("sr_shopkeeper", customerCookie))).status, 401);
      assert.equal((await t.call("GET", "/api/shopkeeper/billing", withCookie("sr_customer", customerCookie))).status, 401, "the cookie of one role is not read for the other");
    });

    it("loses to an Authorization header, so a client that sets one is judged by it alone", async () => {
      const c = await customer();
      const cookie = valueOf(sessionCookie((await cookieLogin(c.email)).headers, "sr_customer")!);
      const res = await t.call("GET", "/api/customers/me", { token: "not-a-real-token", headers: { Cookie: `sr_customer=${cookie}` } });
      assert.equal(res.status, 401);
    });

    it("stops working when the account signs out everywhere, and the browser is told to drop it", async () => {
      const c = await customer();
      const cookie = valueOf(sessionCookie((await cookieLogin(c.email)).headers, "sr_customer")!);
      const out = await t.call("POST", "/api/customers/me/logout-all", withCookie("sr_customer", cookie));
      assert.equal(out.status, 200);
      assert.match(sessionCookie(out.headers, "sr_customer") ?? "", /Max-Age=0/);
      t.clearSessionCache();
      assert.equal((await t.call("GET", "/api/customers/me", withCookie("sr_customer", cookie))).status, 401);
    });

    it("is replaced when the password changes, and the old cookie dies", async () => {
      const c = await customer();
      const old = valueOf(sessionCookie((await cookieLogin(c.email)).headers, "sr_customer")!);
      const res = await t.call("PATCH", "/api/customers/me/password", { body: { currentPassword: PASSWORD, newPassword: "a-brand-new-pass-1" }, ...withCookie("sr_customer", old, COOKIE_MODE) });
      assert.equal(res.status, 200, JSON.stringify(res.json));
      assert.equal(res.json.token, undefined);
      const fresh = valueOf(sessionCookie(res.headers, "sr_customer")!);
      t.clearSessionCache();
      assert.equal((await t.call("GET", "/api/customers/me", withCookie("sr_customer", fresh))).status, 200);
      assert.equal((await t.call("GET", "/api/customers/me", withCookie("sr_customer", old))).status, 401);
    });
  });

  describe("signing out", () => {
    it("clears the cookie with no session needed, and says nothing else", async () => {
      for (const [path, name] of [["/api/customers/logout", "sr_customer"], ["/api/shopkeeper/logout", "sr_shopkeeper"]] as const) {
        const res = await t.call("POST", path);
        assert.equal(res.status, 200);
        const cleared = sessionCookie(res.headers, name);
        assert.ok(cleared?.includes("Max-Age=0") && cleared.includes("HttpOnly"), cleared);
      }
    });
  });

  describe("requests another site could have started", () => {
    const write = (cookie: string, headers: Record<string, string>) =>
      t.call("PATCH", "/api/customers/me", { body: { fullName: "Asha Rao" }, ...withCookie("sr_customer", cookie, headers) });

    it("refuses a cookie-authenticated write from an origin that is not allowed, and allows the web app", async () => {
      process.env.CORS_ORIGINS = APP;
      const c = await customer();
      const cookie = valueOf(sessionCookie((await cookieLogin(c.email)).headers, "sr_customer")!);

      const foreign = await write(cookie, { Origin: "https://evil.example.test" });
      assert.equal(foreign.status, 403);
      assert.equal((await write(cookie, { Origin: APP })).status, 200);
      assert.equal((await write(cookie, { Origin: `${APP}/` })).status, 200, "a trailing slash does not matter");
      assert.equal((await write(cookie, { "Sec-Fetch-Site": "cross-site" })).status, 403, "no Origin, but the browser says cross-site");
      assert.equal((await write(cookie, {})).status, 200, "no Origin and no browser hints: a script, not a browser");
    });

    it("only guards writes made with the cookie: reads, and requests with a header token, are not affected", async () => {
      process.env.CORS_ORIGINS = APP;
      const c = await customer();
      const cookie = valueOf(sessionCookie((await cookieLogin(c.email)).headers, "sr_customer")!);
      assert.equal((await t.call("GET", "/api/customers/me", withCookie("sr_customer", cookie, { Origin: "https://evil.example.test" }))).status, 200, "reads are exempt (the browser's CORS rules keep another site from reading the answer)");

      const token = (await t.call("POST", "/api/customers/login", { body: { email: c.email, password: PASSWORD } })).json.token as string;
      const res = await t.call("PATCH", "/api/customers/me", { token, body: { fullName: "Asha Rao" }, headers: { Origin: "https://evil.example.test" } });
      assert.equal(res.status, 200, "a bearer token is not something another site's page can attach");
    });

    it("answers a browser's pre-flight with credentials allowed for the web app only", async () => {
      process.env.CORS_ORIGINS = APP;
      const ok = await t.call("OPTIONS", "/api/customers/me", { headers: { Origin: APP, "Access-Control-Request-Method": "PATCH", "Access-Control-Request-Headers": "content-type,x-session-mode" } });
      assert.equal(ok.headers.get("access-control-allow-origin"), APP);
      assert.equal(ok.headers.get("access-control-allow-credentials"), "true");
      assert.match(ok.headers.get("access-control-allow-headers") ?? "", /x-session-mode/i);
      const evil = await t.call("OPTIONS", "/api/customers/me", { headers: { Origin: "https://evil.example.test", "Access-Control-Request-Method": "PATCH" } });
      assert.notEqual(evil.headers.get("access-control-allow-origin"), "https://evil.example.test");
    });
  });

  describe("cookie attributes", () => {
    it("adds Secure in production, and the domain when one is configured", async () => {
      const c = await customer();
      process.env.NODE_ENV = "production";
      process.env.COOKIE_DOMAIN = ".example.test";
      const cookie = sessionCookie((await cookieLogin(c.email)).headers, "sr_customer");
      delete process.env.NODE_ENV;
      assert.ok(cookie?.includes("Secure") && cookie.includes("Domain=.example.test") && cookie.includes("HttpOnly"), cookie);
    });

    it("forces Secure with SameSite=None, and ignores a value it does not know", async () => {
      const c = await customer();
      process.env.COOKIE_SAMESITE = "none";
      const none = sessionCookie((await cookieLogin(c.email)).headers, "sr_customer");
      assert.ok(none?.includes("SameSite=None") && none.includes("Secure"), none);
      process.env.COOKIE_SAMESITE = "whatever";
      assert.ok(sessionCookie((await cookieLogin(c.email)).headers, "sr_customer")?.includes("SameSite=Lax"));
    });
  });
});
