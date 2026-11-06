import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createCustomer, createShop, integrationConfigured, resetDatabase } from "../test/integration.js";
import { startTestApp, type TestApp } from "../test/http.js";
import { hashPassword } from "../utils/password.js";
import { stepAt, totpForStep } from "../utils/totp.js";
import { signMfaPendingToken } from "../utils/jwt.js";

const enabled = integrationConfigured();
const PASSWORD = "owner-pass-123";

describe("two-step verification", { skip: !enabled }, () => {
  let t: TestApp;

  before(async () => {
    t = await startTestApp();
  });
  after(() => t.close());
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await t.prisma.securityEvent.deleteMany();
    await t.prisma.mfaCredential.deleteMany();
    t.clearSessionCache();
    t.newClientIp();
  });

  type Who = { id: string; email: string; token: string };
  async function customer(): Promise<Who> {
    const fixture = await createCustomer(t.prisma);
    const row = await t.prisma.customer.update({ where: { id: fixture.customerId }, data: { passwordHash: await hashPassword(PASSWORD) }, select: { email: true } });
    return { id: fixture.customerId, email: row.email, token: t.customerToken(fixture.customerId) };
  }
  async function shopkeeper(): Promise<Who> {
    const shop = await createShop(t.prisma);
    const row = await t.prisma.shopkeeper.update({ where: { id: shop.shopkeeperId }, data: { passwordHash: await hashPassword(PASSWORD) }, select: { email: true } });
    return { id: shop.shopkeeperId, email: row.email, token: t.shopkeeperToken(shop.shopkeeperId) };
  }

  const api = (base: string) => ({
    status: (token: string) => t.call("GET", `${base}/me/mfa`, { token }),
    setup: (token: string | undefined, body: unknown = { password: PASSWORD }) => t.call("POST", `${base}/me/mfa/setup`, { token, body }),
    enable: (token: string, code: string) => t.call("POST", `${base}/me/mfa/enable`, { token, body: { code } }),
    disable: (token: string, body: unknown) => t.call("POST", `${base}/me/mfa/disable`, { token, body }),
    recovery: (token: string, body: unknown) => t.call("POST", `${base}/me/mfa/recovery-codes`, { token, body }),
    login: (email: string, password = PASSWORD) => t.call("POST", `${base}/login`, { body: { email, password } }),
    second: (mfaToken: string, code: string, ip?: string) => t.call("POST", `${base}/login/mfa`, { body: { mfaToken, code }, ip }),
  });
  const customers = api("/api/customers");
  const shops = api("/api/shopkeeper");

  const now = () => stepAt(Date.now());
  const codeNow = (secret: string, offset = 0) => totpForStep(secret, now() + offset);

  /** Turns two-step verification on and returns what the person would keep. */
  async function turnOn(a: typeof customers, who: Who) {
    const setup = await a.setup(who.token);
    assert.equal(setup.status, 200, JSON.stringify(setup.json));
    const secret = setup.json.data.secret as string;
    const enabledRes = await a.enable(who.token, codeNow(secret));
    assert.equal(enabledRes.status, 200, JSON.stringify(enabledRes.json));
    return { secret, recoveryCodes: enabledRes.json.data.recoveryCodes as string[] };
  }

  describe("turning it on", () => {
    it("needs a session and the password again", async () => {
      const c = await customer();
      assert.equal((await customers.setup(undefined)).status, 401);
      assert.equal((await customers.setup(c.token, { password: "wrong-password-1" })).status, 403);
      assert.equal((await customers.setup(c.token, {})).status, 403, "a session alone is not enough");
      assert.equal(await t.prisma.mfaCredential.count(), 0);
    });

    it("hands out a secret and a link, stores the secret encrypted, and protects nothing until a code proves the app works", async () => {
      const c = await customer();
      const setup = await customers.setup(c.token);
      assert.equal(setup.status, 200);
      const { secret, otpauthUrl } = setup.json.data;
      assert.match(secret, /^[A-Z2-7]{32}$/);
      assert.ok(otpauthUrl.startsWith("otpauth://totp/ShopRoom%3A") && otpauthUrl.includes(`secret=${secret}`));

      const stored = await t.prisma.mfaCredential.findFirstOrThrow();
      assert.ok(!stored.secretEnc.includes(secret), "the secret is not stored in the clear");
      assert.equal(stored.enabledAt, null);
      assert.equal((await customers.login(c.email)).json.token !== undefined, true, "sign-in is unchanged while setup is pending");

      assert.equal((await customers.enable(c.token, "000000")).status, 400);
      assert.equal((await customers.status(c.token)).json.data.enabled, false);
    });

    it("turns on with a right code and returns ten recovery codes once, stored only as hashes", async () => {
      const c = await customer();
      const { recoveryCodes } = await turnOn(customers, c);
      assert.equal(recoveryCodes.length, 10);
      assert.equal(new Set(recoveryCodes).size, 10);
      for (const code of recoveryCodes) assert.match(code, /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);

      assert.deepEqual((await customers.status(c.token)).json.data, { enabled: true, recoveryCodesLeft: 10 });
      const rows = JSON.stringify(await t.prisma.mfaRecoveryCode.findMany());
      for (const code of recoveryCodes) assert.ok(!rows.includes(code.replace("-", "")) && !rows.includes(code), "recovery codes are not stored");

      assert.equal((await customers.setup(c.token)).status, 409, "cannot start again while it is on");
      for (let i = 0; i < 100 && (await t.prisma.securityEvent.count({ where: { type: "MFA_ENABLED", actorId: c.id } })) === 0; i += 1) await new Promise((r) => setTimeout(r, 20));
      assert.equal(await t.prisma.securityEvent.count({ where: { type: "MFA_ENABLED", actorId: c.id } }), 1, "turning it on is logged");
    });
  });

  describe("signing in", () => {
    it("asks for the second step instead of giving a session, then accepts a right code", async () => {
      const c = await customer();
      const { secret } = await turnOn(customers, c);

      const first = await customers.login(c.email);
      assert.equal(first.status, 200);
      assert.equal(first.json.mfaRequired, true);
      assert.equal(first.json.token, undefined, "no session yet");
      const mfaToken = first.json.mfaToken as string;

      const wrong = await customers.second(mfaToken, "000000");
      assert.equal(wrong.status, 401);
      assert.equal(wrong.json.token, undefined);

      // Setup already used this moment's code (a code works once), so the app's next one is used here.
      const ok = await customers.second(mfaToken, codeNow(secret, 1));
      assert.equal(ok.status, 200, JSON.stringify(ok.json));
      assert.equal((await t.call("GET", "/api/customers/me", { token: ok.json.token })).status, 200, "the session works");
    });

    it("never accepts the same code twice", async () => {
      const c = await customer();
      const { secret } = await turnOn(customers, c);
      const code = codeNow(secret, 1); // a step the setup did not use
      assert.equal((await customers.second((await customers.login(c.email)).json.mfaToken, code)).status, 200);
      assert.equal((await customers.second((await customers.login(c.email)).json.mfaToken, code)).status, 401, "replaying a seen code fails");
    });

    it("lets a recovery code in once, and tells the owner", async () => {
      const c = await customer();
      const { recoveryCodes } = await turnOn(customers, c);
      const spaced = recoveryCodes[0].toLowerCase().replace("-", " ");
      const ok = await customers.second((await customers.login(c.email)).json.mfaToken, spaced);
      assert.equal(ok.status, 200, JSON.stringify(ok.json));
      assert.equal((await customers.second((await customers.login(c.email)).json.mfaToken, recoveryCodes[0])).status, 401, "a used recovery code is spent");
      assert.deepEqual((await customers.status(c.token)).json.data, { enabled: true, recoveryCodesLeft: 9 });
      for (let i = 0; i < 100 && (await t.prisma.securityEvent.count({ where: { type: "MFA_RECOVERY_USED" } })) === 0; i += 1) await new Promise((r) => setTimeout(r, 20));
      assert.equal(await t.prisma.securityEvent.count({ where: { type: "MFA_RECOVERY_USED", actorId: c.id } }), 1);
    });

    it("rejects a second-step token that is forged, from the other role, a session, or out of date", async () => {
      const c = await customer();
      const s = await shopkeeper();
      const { secret } = await turnOn(customers, c);
      const code = codeNow(secret, 1);

      assert.equal((await customers.second("not-a-token-at-all", code)).status, 401);
      const other = signMfaPendingToken("SHOPKEEPER", c.id, 0);
      assert.equal((await customers.second(other, code)).status, 401, "a shopkeeper token cannot finish a customer sign-in");
      assert.equal((await customers.second(c.token, code)).status, 401, "a session token is not a second-step token");
      const tampered = (await customers.login(c.email)).json.mfaToken.replace(/.$/, "A");
      assert.equal((await customers.second(tampered, code)).status, 401);

      // The second-step token is not a session either.
      const real = (await customers.login(c.email)).json.mfaToken as string;
      assert.equal((await t.call("GET", "/api/customers/me", { token: real })).status, 401);

      // A password change after the first step voids it.
      await t.prisma.customer.update({ where: { id: c.id }, data: { tokenVersion: { increment: 1 } } });
      t.clearSessionCache();
      assert.equal((await customers.second(real, code)).status, 401);
      assert.equal(s.id.length > 0, true);
    });

    it("limits guesses per account no matter how many addresses they come from", async () => {
      const c = await customer();
      await turnOn(customers, c);
      const mfaToken = (await customers.login(c.email)).json.mfaToken as string;
      const statuses: number[] = [];
      for (let i = 0; i < 11; i += 1) statuses.push((await customers.second(mfaToken, String(100_000 + i), `10.77.${i}.1`)).status);
      assert.equal(statuses.filter((s) => s === 401).length, 8);
      assert.ok(statuses.slice(8).every((s) => s === 429), `the rest are throttled: ${statuses}`);
    });

    it("works the same way for a shopkeeper", async () => {
      const s = await shopkeeper();
      const { secret } = await turnOn(shops, s);
      const first = await shops.login(s.email);
      assert.equal(first.json.mfaRequired, true);
      assert.equal(first.json.token, undefined);
      const ok = await shops.second(first.json.mfaToken, codeNow(secret, 1));
      assert.equal(ok.status, 200, JSON.stringify(ok.json));
      assert.deepEqual([typeof ok.json.token, ok.json.shopkeeperId], ["string", s.id]);
      assert.equal(typeof ok.json.shopName, "string");
      assert.equal((await shops.second((await shops.login(s.email)).json.mfaToken, "123456")).status, 401);
    });
  });

  describe("turning it off and replacing recovery codes", () => {
    it("needs the password and a current code", async () => {
      const c = await customer();
      const { secret } = await turnOn(customers, c);
      assert.equal((await customers.disable(c.token, { password: PASSWORD, code: "000000" })).status, 403);
      assert.equal((await customers.disable(c.token, { password: "wrong-password-1", code: codeNow(secret, 1) })).status, 403);
      assert.equal((await customers.disable(c.token, { code: codeNow(secret, 1) })).status, 403);
      assert.equal((await customers.status(c.token)).json.data.enabled, true);

      assert.equal((await customers.disable(c.token, { password: PASSWORD, code: codeNow(secret, 1) })).status, 200);
      assert.equal((await customers.status(c.token)).json.data.enabled, false);
      assert.equal((await customers.login(c.email)).json.mfaRequired, undefined, "back to the password alone");
      assert.equal(await t.prisma.mfaRecoveryCode.count(), 0);
    });

    it("replaces recovery codes only with a current code, and the old ones stop working", async () => {
      const c = await customer();
      const { secret, recoveryCodes } = await turnOn(customers, c);
      assert.equal((await customers.recovery(c.token, { password: PASSWORD, code: "000000" })).status, 403);
      const fresh = await customers.recovery(c.token, { password: PASSWORD, code: codeNow(secret, 1) });
      assert.equal(fresh.status, 200, JSON.stringify(fresh.json));
      const newCodes = fresh.json.data.recoveryCodes as string[];
      assert.equal(newCodes.length, 10);
      assert.equal((await customers.second((await customers.login(c.email)).json.mfaToken, recoveryCodes[1])).status, 401);
      assert.equal((await customers.second((await customers.login(c.email)).json.mfaToken, newCodes[1])).status, 200);
    });
  });

  it("is erased with the account", async () => {
    const c = await customer();
    await turnOn(customers, c);
    assert.equal((await t.call("DELETE", "/api/customers/me", { token: c.token, body: { password: PASSWORD } })).status, 200);
    assert.equal(await t.prisma.mfaCredential.count(), 0);
    assert.equal(await t.prisma.mfaRecoveryCode.count(), 0);
  });
});
