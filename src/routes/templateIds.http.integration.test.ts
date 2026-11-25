import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createShop, integrationConfigured, resetDatabase } from "../test/integration.js";
import { startTestApp, type TestApp } from "../test/http.js";

const enabled = integrationConfigured();

interface ListBody { data: { items: { id: string }[]; total: number } }

describe("GET /api/notifications/templates?ids=", { skip: !enabled }, () => {
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

  it("returns only the requested, active templates (the Favourites tab)", async () => {
    const shop = await createShop(t.prisma);
    const token = t.shopkeeperToken(shop.shopkeeperId);
    // Catalog tables are not truncated between tests, so use unique rows and remove them afterwards.
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    const category = await t.prisma.notificationCategory.create({ data: { slug: `ids-test-${suffix}`, name: "Ids test" } });
    const make = (n: number, isActive = true) =>
      t.prisma.notificationTemplate.create({
        data: { slug: `ids-template-${suffix}-${n}`, name: `T${n}`, categoryId: category.id, designJson: {}, isActive },
        select: { id: true },
      });
    const [a, b, c, hidden] = await Promise.all([make(1), make(2), make(3), make(4, false)]);
    try {
      const res = await t.call("GET", `/api/notifications/templates?ids=${a.id},${c.id},${hidden.id},${a.id}&limit=24`, { token });
      assert.equal(res.status, 200);
      const body = res.json as ListBody;
      assert.deepEqual(body.data.items.map((i) => i.id).sort(), [a.id, c.id].sort());
      assert.equal(body.data.total, 2, "inactive templates and duplicates are not counted");
      assert.ok(!body.data.items.some((i) => i.id === b.id));
    } finally {
      await t.prisma.notificationTemplate.deleteMany({ where: { id: { in: [a.id, b.id, c.id, hidden.id] } } });
      await t.prisma.notificationCategory.delete({ where: { id: category.id } });
    }
  });

  it("returns every requested template when no limit is given, and refuses a limit that would cut them off", async () => {
    const shop = await createShop(t.prisma);
    const token = t.shopkeeperToken(shop.shopkeeperId);
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    const category = await t.prisma.notificationCategory.create({ data: { slug: `ids-limit-${suffix}`, name: "Ids limit" } });
    const rows = await Promise.all(
      Array.from({ length: 12 }, (_, n) =>
        t.prisma.notificationTemplate.create({ data: { slug: `ids-limit-${suffix}-${n}`, name: `T${n}`, categoryId: category.id, designJson: {} }, select: { id: true } }),
      ),
    );
    const ids = rows.map((r) => r.id).join(",");
    try {
      const all = await t.call("GET", `/api/notifications/templates?ids=${ids}`, { token });
      assert.equal(all.status, 200);
      assert.equal((all.json as ListBody).data.items.length, 12, "the default page of 10 must not cut a request for 12 ids short");
      assert.equal((await t.call("GET", `/api/notifications/templates?ids=${ids}&limit=5`, { token })).status, 400, "a limit below the number of ids would hide some");
      assert.equal((await t.call("GET", `/api/notifications/templates?limit=5`, { token })).status, 200, "without ids a limit is just a page size");
    } finally {
      await t.prisma.notificationTemplate.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
      await t.prisma.notificationCategory.delete({ where: { id: category.id } });
    }
  });

  it("rejects more than one page of ids and an empty list", async () => {
    const shop = await createShop(t.prisma);
    const token = t.shopkeeperToken(shop.shopkeeperId);
    const tooMany = Array.from({ length: 25 }, (_, i) => `id${i}`).join(",");
    assert.equal((await t.call("GET", `/api/notifications/templates?ids=${tooMany}`, { token })).status, 400);
    assert.equal((await t.call("GET", "/api/notifications/templates?ids=,", { token })).status, 400);
  });
});
