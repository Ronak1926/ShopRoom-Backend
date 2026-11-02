import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { connectTestEnvironment, integrationConfigured, type TestPrisma } from "../test/integration.js";

const enabled = integrationConfigured();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Postgres rate-limit store", { skip: !enabled }, () => {
  let prisma: TestPrisma;
  let PostgresRateLimitStore: typeof import("./postgresRateLimitStore.js").PostgresRateLimitStore;

  before(async () => {
    ({ prisma } = await connectTestEnvironment());
    ({ PostgresRateLimitStore } = await import("./postgresRateLimitStore.js"));
  });
  after(() => prisma.$disconnect());
  beforeEach(() => prisma.rateLimitCounter.deleteMany());

  const store = (name = "t", windowMs = 60_000) => {
    const s = new PostgresRateLimitStore(name);
    s.init({ windowMs } as never);
    return s;
  };

  it("counts hits within a window and reports when it resets", async () => {
    const s = store();
    const first = await s.increment("client");
    const second = await s.increment("client");
    assert.equal(first.totalHits, 1);
    assert.equal(second.totalHits, 2);
    const msLeft = second.resetTime!.getTime() - Date.now();
    assert.ok(msLeft > 55_000 && msLeft <= 60_000, `window has ${msLeft}ms left`);
    assert.equal(first.resetTime!.getTime(), second.resetTime!.getTime(), "later hits do not extend the window");
  });

  it("is shared: two instances of the store (two API servers) see one count", async () => {
    const a = store();
    const b = store();
    await a.increment("attacker");
    await b.increment("attacker");
    assert.equal((await a.increment("attacker")).totalHits, 3);
    assert.equal((await b.get("attacker"))?.totalHits, 3);
  });

  it("counts exactly under concurrent hits", async () => {
    const s = store();
    await Promise.all(Array.from({ length: 50 }, () => s.increment("burst")));
    assert.equal((await s.get("burst"))?.totalHits, 50);
  });

  it("starts a fresh window once the old one ends", async () => {
    const s = store("short", 300);
    await s.increment("k");
    await s.increment("k");
    await sleep(450);
    assert.equal(await s.get("k"), undefined, "an expired counter is not reported");
    assert.equal((await s.increment("k")).totalHits, 1);
  });

  it("keeps different limiters and different clients apart", async () => {
    const login = store("login");
    const otp = store("otp");
    await login.increment("1.2.3.4");
    await login.increment("1.2.3.4");
    assert.equal((await otp.increment("1.2.3.4")).totalHits, 1, "same key, different limiter");
    assert.equal((await login.increment("5.6.7.8")).totalHits, 1, "same limiter, different client");
  });

  it("supports decrement, reset and resetAll", async () => {
    const s = store("ops");
    const other = store("keep");
    await s.increment("a");
    await s.increment("a");
    await s.decrement("a");
    assert.equal((await s.get("a"))?.totalHits, 1);
    await s.decrement("a");
    await s.decrement("a");
    assert.equal((await s.get("a"))?.totalHits, 0, "never goes negative");

    await s.increment("b");
    await other.increment("b");
    await s.resetKey("a");
    assert.equal(await s.get("a"), undefined);
    await s.resetAll();
    assert.equal(await s.get("b"), undefined);
    assert.equal((await other.get("b"))?.totalHits, 1, "another limiter's counters survive resetAll");
  });
});
