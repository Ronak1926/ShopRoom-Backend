import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, beforeEach, describe, it, mock } from "node:test";
import nodemailer from "nodemailer";
import { createCustomer, createShop, integrationConfigured, resetDatabase } from "../test/integration.js";
import { startTestApp, type TestApp } from "../test/http.js";
import { hashPassword } from "../utils/password.js";

const enabled = integrationConfigured();
const OLD = "old-password-123";
const NEW = "brand-new-pass-456";

describe("forgot, reset and change password", { skip: !enabled }, () => {
  let t: TestApp;
  const emails: { to: string; text: string }[] = [];

  before(async () => {
    process.env.FRONTEND_BASE_URL = "https://app.shoproom.example";
    mock.method(nodemailer, "createTransport", () => ({
      sendMail: async (message: { to: string; text: string }) => void emails.push(message),
    }));
    t = await startTestApp();
  });
  after(async () => {
    mock.restoreAll();
    delete process.env.FRONTEND_BASE_URL;
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await t.prisma.passwordResetToken.deleteMany();
    t.clearSessionCache();
    t.newClientIp();
    emails.length = 0;
  });

  async function customer(email = `c${Math.random().toString(36).slice(2, 8)}@example.test`) {
    const made = await createCustomer(t.prisma);
    await t.prisma.customer.update({ where: { id: made.customerId }, data: { email, passwordHash: await hashPassword(OLD) } });
    return { id: made.customerId, email };
  }
  async function shopkeeper() {
    const shop = await createShop(t.prisma);
    const row = await t.prisma.shopkeeper.update({ where: { id: shop.shopkeeperId }, data: { passwordHash: await hashPassword(OLD) } });
    return { id: shop.shopkeeperId, email: row.email };
  }
  const waitForEmail = async (count = 1) => {
    for (let i = 0; i < 100 && emails.length < count; i += 1) await new Promise((r) => setTimeout(r, 20));
  };
  const tokenFrom = (text: string) => /#token=([A-Za-z0-9_-]+)&role=(\w+)/.exec(text);

  describe("asking for a link", () => {
    it("emails a one-time link whose token is in the fragment, and stores only its hash", async () => {
      const c = await customer();
      const res = await t.call("POST", "/api/customers/forgot-password", { body: { email: c.email } });
      assert.equal(res.status, 200);
      await waitForEmail();
      assert.equal(emails.length, 1);
      assert.equal(emails[0].to, c.email);
      const match = tokenFrom(emails[0].text);
      assert.ok(match, "link carries a token in the URL fragment");
      assert.ok(emails[0].text.includes("https://app.shoproom.example/reset-password#token="));
      assert.equal(match![2], "customer");

      const row = await t.prisma.passwordResetToken.findFirstOrThrow({ where: { accountId: c.id } });
      assert.notEqual(row.tokenHash, match![1]);
      assert.equal(row.tokenHash, createHash("sha256").update(match![1]).digest("hex"));
      const ttl = row.expiresAt.getTime() - Date.now();
      assert.ok(ttl > 28 * 60_000 && ttl <= 30 * 60_000, `expires in ${Math.round(ttl / 60_000)} min`);
    });

    it("answers the same whether or not the address has an account, and sends nothing for strangers", async () => {
      const c = await customer();
      const known = await t.call("POST", "/api/customers/forgot-password", { body: { email: c.email } });
      const unknown = await t.call("POST", "/api/customers/forgot-password", { body: { email: "nobody@example.test" } });
      assert.equal(known.status, unknown.status);
      assert.deepEqual(known.json, unknown.json);
      await waitForEmail();
      await new Promise((r) => setTimeout(r, 150));
      assert.equal(emails.length, 1, "only the real account got an email");
    });

    it("keeps customers and shopkeepers apart", async () => {
      const s = await shopkeeper();
      await t.call("POST", "/api/customers/forgot-password", { body: { email: s.email } });
      await new Promise((r) => setTimeout(r, 200));
      assert.equal(emails.length, 0, "a shopkeeper's address is no customer account");
      await t.call("POST", "/api/shopkeeper/forgot-password", { body: { email: s.email } });
      await waitForEmail();
      assert.equal(tokenFrom(emails[0].text)![2], "shopkeeper");
    });

    it("sends one link per minute and voids older ones", async () => {
      const c = await customer();
      await t.call("POST", "/api/customers/forgot-password", { body: { email: c.email } });
      await waitForEmail();
      await t.call("POST", "/api/customers/forgot-password", { body: { email: c.email } });
      await new Promise((r) => setTimeout(r, 200));
      assert.equal(emails.length, 1, "the second request inside the cooldown sends nothing");

      await t.prisma.passwordResetToken.updateMany({ where: { accountId: c.id }, data: { createdAt: new Date(Date.now() - 120_000) } });
      const first = tokenFrom(emails[0].text)![1];
      await t.call("POST", "/api/customers/forgot-password", { body: { email: c.email } });
      await waitForEmail(2);
      assert.equal(await t.prisma.passwordResetToken.count({ where: { accountId: c.id } }), 1);
      const stale = await t.call("POST", "/api/customers/reset-password", { body: { token: first, password: NEW } });
      assert.equal(stale.status, 400, "the earlier link no longer works");
    });

    it("rejects malformed addresses and throttles repeated requests", async () => {
      assert.equal((await t.call("POST", "/api/customers/forgot-password", { body: { email: "not-an-email" } })).status, 400);
      const ip = "172.40.1.1";
      const statuses: number[] = [];
      for (let i = 0; i < 4; i += 1) statuses.push((await t.call("POST", "/api/customers/forgot-password", { ip, body: { email: "flood@example.test" } })).status);
      assert.deepEqual(statuses, [200, 200, 200, 429], "three per address per hour");
    });
  });

  describe("choosing a new password", () => {
    async function link(role: "customers" | "shopkeeper", email: string) {
      await t.call("POST", `/api/${role}/forgot-password`, { body: { email } });
      await waitForEmail();
      return tokenFrom(emails.at(-1)!.text)![1];
    }

    it("sets the password, ends every session, and the token works once", async () => {
      const c = await customer();
      const oldToken = t.customerToken(c.id);
      assert.equal((await t.call("GET", "/api/customers/me", { token: oldToken })).status, 200);

      const token = await link("customers", c.email);
      const done = await t.call("POST", "/api/customers/reset-password", { body: { token, password: NEW } });
      assert.equal(done.status, 200, JSON.stringify(done.json));

      t.clearSessionCache();
      assert.equal((await t.call("GET", "/api/customers/me", { token: oldToken })).status, 401, "old sessions are signed out");
      assert.equal((await t.call("POST", "/api/customers/login", { body: { email: c.email, password: OLD } })).status, 401);
      assert.equal((await t.call("POST", "/api/customers/login", { body: { email: c.email, password: NEW } })).status, 200);

      const again = await t.call("POST", "/api/customers/reset-password", { body: { token, password: "another-pass-789" } });
      assert.equal(again.status, 400, "a used link is dead");
    });

    it("refuses unknown, expired and wrong-role tokens with one message", async () => {
      const c = await customer();
      const s = await shopkeeper();
      const customerToken = await link("customers", c.email);
      const bodyFor = (token: string) => ({ token, password: NEW });

      const unknown = await t.call("POST", "/api/customers/reset-password", { body: bodyFor("x".repeat(43)) });
      await t.prisma.passwordResetToken.updateMany({ where: { accountId: c.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      const expired = await t.call("POST", "/api/customers/reset-password", { body: bodyFor(customerToken) });
      emails.length = 0;
      const shopToken = await link("shopkeeper", s.email);
      const wrongRole = await t.call("POST", "/api/customers/reset-password", { body: bodyFor(shopToken) });

      for (const res of [unknown, expired, wrongRole]) assert.equal(res.status, 400);
      assert.deepEqual(unknown.json, expired.json);
      assert.deepEqual(unknown.json, wrongRole.json);
      assert.equal((await t.prisma.shopkeeper.findUniqueOrThrow({ where: { id: s.id } })).tokenVersion, 0, "nothing changed");
    });

    it("applies the password rules and leaves the account alone when they fail", async () => {
      const c = await customer();
      const token = await link("customers", c.email);
      for (const password of ["short", "a".repeat(73), ""]) {
        assert.equal((await t.call("POST", "/api/customers/reset-password", { body: { token, password } })).status, 400, password.slice(0, 8));
      }
      assert.equal((await t.call("POST", "/api/customers/reset-password", { body: { token: "bad token!", password: NEW } })).status, 400);
      assert.equal((await t.call("POST", "/api/customers/login", { body: { email: c.email, password: OLD } })).status, 200, "old password still works");
      assert.equal((await t.call("POST", "/api/customers/reset-password", { body: { token, password: NEW } })).status, 200, "the link survived the failed tries");
    });

    it("lets only one of several racing requests use a token", async () => {
      const c = await customer();
      const token = await link("customers", c.email);
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) => t.call("POST", "/api/customers/reset-password", { body: { token, password: `racing-pass-${i}-xyz` } })),
      );
      assert.equal(results.filter((r) => r.status === 200).length, 1);
    });

    it("resets a shopkeeper the same way", async () => {
      const s = await shopkeeper();
      const token = await link("shopkeeper", s.email);
      assert.equal((await t.call("POST", "/api/shopkeeper/reset-password", { body: { token, password: NEW } })).status, 200);
      assert.equal((await t.call("POST", "/api/shopkeeper/login", { body: { email: s.email, password: NEW } })).status, 200);
    });

    it("lets a Google-only customer set a password, and counts the reset as proof of the address", async () => {
      const made = await createCustomer(t.prisma);
      await t.prisma.customer.update({ where: { id: made.customerId }, data: { passwordHash: null, firebaseUid: "g-1", emailVerified: false } });
      const email = (await t.prisma.customer.findUniqueOrThrow({ where: { id: made.customerId } })).email;
      const token = await link("customers", email);
      assert.equal((await t.call("POST", "/api/customers/reset-password", { body: { token, password: NEW } })).status, 200);
      assert.equal((await t.prisma.customer.findUniqueOrThrow({ where: { id: made.customerId } })).emailVerified, true);
    });
  });

  describe("changing it while signed in", () => {
    it("needs the current password, signs out other devices and keeps this one", async () => {
      const c = await customer();
      const here = t.customerToken(c.id);
      const elsewhere = t.customerToken(c.id);

      const wrong = await t.call("PATCH", "/api/customers/me/password", { token: here, body: { currentPassword: "nope-nope-1", newPassword: NEW } });
      assert.equal(wrong.status, 403);
      assert.equal((await t.call("POST", "/api/customers/login", { body: { email: c.email, password: OLD } })).status, 200, "unchanged");

      const ok = await t.call("PATCH", "/api/customers/me/password", { token: here, body: { currentPassword: OLD, newPassword: NEW } });
      assert.equal(ok.status, 200);
      t.clearSessionCache();
      assert.equal((await t.call("GET", "/api/customers/me", { token: elsewhere })).status, 401, "other sessions end");
      assert.equal((await t.call("GET", "/api/customers/me", { token: ok.json.token })).status, 200, "this one continues on the returned token");
    });

    it("refuses an unchanged password, a weak one, and anonymous callers", async () => {
      const c = await customer();
      const token = t.customerToken(c.id);
      assert.equal((await t.call("PATCH", "/api/customers/me/password", { token, body: { currentPassword: OLD, newPassword: OLD } })).status, 400);
      assert.equal((await t.call("PATCH", "/api/customers/me/password", { token, body: { currentPassword: OLD, newPassword: "short" } })).status, 400);
      assert.equal((await t.call("PATCH", "/api/customers/me/password", { body: { currentPassword: OLD, newPassword: NEW } })).status, 401);
    });

    it("works for shopkeepers and explains Google-only accounts", async () => {
      const s = await shopkeeper();
      const ok = await t.call("PATCH", "/api/shopkeeper/me/password", { token: t.shopkeeperToken(s.id), body: { currentPassword: OLD, newPassword: NEW } });
      assert.equal(ok.status, 200);
      assert.equal((await t.call("POST", "/api/shopkeeper/login", { body: { email: s.email, password: NEW } })).status, 200);

      const g = await createCustomer(t.prisma);
      await t.prisma.customer.update({ where: { id: g.customerId }, data: { passwordHash: null } });
      const res = await t.call("PATCH", "/api/customers/me/password", { token: t.customerToken(g.customerId), body: { currentPassword: "x", newPassword: NEW } });
      assert.equal(res.status, 400);
      assert.match(res.json.message, /Google/);
    });
  });

  it("removes outstanding links when the account is deleted", async () => {
    const c = await customer();
    await t.call("POST", "/api/customers/forgot-password", { body: { email: c.email } });
    await waitForEmail();
    assert.equal(await t.prisma.passwordResetToken.count({ where: { accountId: c.id } }), 1);
    const res = await t.call("DELETE", "/api/customers/me", { token: t.customerToken(c.id), body: { password: OLD } });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(await t.prisma.passwordResetToken.count({ where: { accountId: c.id } }), 0);
  });
});
