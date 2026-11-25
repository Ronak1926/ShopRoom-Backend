import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { connectTestEnvironment, integrationConfigured, type TestPrisma } from "../test/integration.js";

const enabled = integrationConfigured();

// This file runs in its own process, so the pool settings below are read when the
// client is first imported.
describe("connection pool limits", { skip: !enabled }, () => {
  let prisma: TestPrisma;

  before(async () => {
    process.env.DB_POOL_MAX = "2";
    process.env.DB_POOL_ACQUIRE_TIMEOUT_MS = "300";
    process.env.DB_STATEMENT_TIMEOUT_MS = "1000";
    ({ prisma } = await connectTestEnvironment());
    await prisma.$queryRaw`SELECT 1`;
  });
  after(() => prisma.$disconnect());

  it("fails fast instead of hanging when every connection is busy", async () => {
    // pg_sleep returns void, which Prisma cannot read; selecting from it yields a normal column.
    const hold = () => prisma.$queryRaw`SELECT 1 AS ok FROM pg_sleep(0.8)`;
    const started = Date.now();
    const results = await Promise.allSettled([hold(), hold(), hold()]);
    const elapsed = Date.now() - started;

    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    assert.equal(rejected.length, 1, "the third caller gives up while two connections are busy");
    assert.match(String(rejected[0].reason), /timeout|connect/i, "and it is the pool's acquire timeout that stops it");
    assert.ok(elapsed < 2_500, `finished in ${elapsed}ms`);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 2);
  });

  it("cancels a runaway query at the statement timeout", async () => {
    const started = Date.now();
    await assert.rejects(prisma.$queryRaw`SELECT 1 AS ok FROM pg_sleep(10)`, /statement timeout|canceling statement|57014/i);
    assert.ok(Date.now() - started < 4_000, "cancelled long before the 10 seconds it asked for");
  });

  it("recovers: the pool serves requests normally afterwards", async () => {
    const rows = await prisma.$queryRaw<{ ok: number }[]>`SELECT 1 AS ok`;
    assert.equal(rows[0].ok, 1);
  });
});
