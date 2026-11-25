import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { integrationConfigured, resetDatabase } from "../test/integration.js";
import { startTestApp, type TestApp } from "../test/http.js";

const enabled = integrationConfigured();

// The limiters read RATE_LIMIT_STORE when the app is first imported, and every test file runs
// in its own process, so choosing the shared store here affects only this file.
describe("rate limits with the shared (Postgres) store", { skip: !enabled }, () => {
  let t: TestApp;

  before(async () => {
    process.env.RATE_LIMIT_STORE = "postgres";
    t = await startTestApp();
  });
  after(async () => {
    delete process.env.RATE_LIMIT_STORE;
    await t.prisma.rateLimitCounter.deleteMany();
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await t.prisma.rateLimitCounter.deleteMany();
    t.newClientIp();
  });

  const attempt = (ip: string, email = "victim@example.test") =>
    t.call("POST", "/api/customers/login", { ip, body: { email, password: "wrong-password-1" } });

  it("keeps login counters in the database, where every API instance can see them", async () => {
    const ip = "172.20.1.1";
    for (let i = 0; i < 3; i += 1) assert.equal((await attempt(ip)).status, 401);

    const rows = await t.prisma.rateLimitCounter.findMany({ select: { key: true, hits: true } });
    const byLimiter = Object.fromEntries(rows.map((r) => [r.key.split(":")[0], r.hits]));
    assert.equal(byLimiter["login-ip"], 3);
    assert.equal(byLimiter["login-account"], 3);
  });

  it("locks an account after the budget and answers 429", async () => {
    const ip = "172.20.2.2";
    const statuses: number[] = [];
    for (let i = 0; i < 10; i += 1) statuses.push((await attempt(ip)).status);
    assert.deepEqual(statuses.slice(0, 8), Array(8).fill(401));
    assert.deepEqual(statuses.slice(8), [429, 429]);
  });

  it("takes its state from the database, not from the process", async () => {
    const ip = "172.20.3.3";
    for (let i = 0; i < 9; i += 1) await attempt(ip);
    assert.equal((await attempt(ip)).status, 429);

    // Another instance (or an operator) clearing the shared counters lifts the lock at once;
    // an in-memory limiter would ignore this and keep answering 429.
    await t.prisma.rateLimitCounter.deleteMany();
    assert.equal((await attempt(ip)).status, 401);
  });

  it("counts a second API instance's attempts toward the same budget", async () => {
    const ip = "172.20.4.4";
    for (let i = 0; i < 6; i += 1) await attempt(ip);
    // What a second instance would have written for the same client and account.
    const key = `login-account:acct:victim@example.test|${ip}`;
    await t.prisma.rateLimitCounter.update({ where: { key }, data: { hits: { increment: 2 } } });
    assert.equal((await attempt(ip)).status, 429, "6 local + 2 from elsewhere + this one exceeds 8");
  });

  it("does not store the global backstop or invite previews in the database", async () => {
    await t.call("GET", "/healthz");
    await t.call("GET", "/api/shop/invite/NOPE1234");
    const keys = (await t.prisma.rateLimitCounter.findMany({ select: { key: true } })).map((r) => r.key);
    assert.ok(!keys.some((k) => k.startsWith("global:") || k.startsWith("invite-preview:")), keys.join(","));
  });
});
