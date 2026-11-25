import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createCustomer, createShop, integrationConfigured, resetDatabase } from "../test/integration.js";
import { startTestApp, type TestApp } from "../test/http.js";

const enabled = integrationConfigured();

describe("HTTP caching", { skip: !enabled }, () => {
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

  it("lets the browser cache slow-changing catalog data, privately", async () => {
    const shop = await createShop(t.prisma);
    const token = t.shopkeeperToken(shop.shopkeeperId);
    // Catalog tables are not truncated between tests, so use unique rows and remove them afterwards.
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    const category = await t.prisma.notificationCategory.create({ data: { slug: `cache-test-${suffix}`, name: "Cache test" } });
    const template = await t.prisma.notificationTemplate.create({
      data: { slug: `cache-template-${suffix}`, name: "T", categoryId: category.id, designJson: {} },
    });
    try {
      await assertCatalogHeaders(token, template.id);
    } finally {
      await t.prisma.notificationTemplate.delete({ where: { id: template.id } });
      await t.prisma.notificationCategory.delete({ where: { id: category.id } });
    }
  });

  async function assertCatalogHeaders(token: string, templateId: string) {

    const expectations: [string, RegExp][] = [
      ["/api/notifications/categories", /^private, max-age=300$/],
      ["/api/notifications/animations", /^private, max-age=60$/],
      ["/api/notifications/templates", /^private, max-age=60$/],
      [`/api/notifications/templates/${templateId}`, /^private, max-age=300$/],
    ];
    for (const [path, expected] of expectations) {
      const res = await t.call("GET", path, { token });
      assert.equal(res.status, 200, path);
      assert.match(res.headers.get("cache-control") ?? "", expected, path);
      assert.ok(res.headers.get("etag"), `${path} can be revalidated cheaply`);
    }
  }

  it("revalidates a catalog response with an ETag instead of resending it", async () => {
    const shop = await createShop(t.prisma);
    const token = t.shopkeeperToken(shop.shopkeeperId);
    const first = await t.call("GET", "/api/notifications/categories", { token });
    // fetch() adds "Cache-Control: no-cache" whenever If-None-Match is set, and Express then
    // skips the 304; browsers revalidating a cached copy send max-age=0, which this mimics.
    const second = await t.call("GET", "/api/notifications/categories", {
      token,
      headers: { "If-None-Match": first.headers.get("etag")!, "Cache-Control": "max-age=0" },
    });
    assert.equal(second.status, 304);
  });

  it("never caches personal, per-user or fast-changing responses", async () => {
    const shop = await createShop(t.prisma);
    const member = await createCustomer(t.prisma, { member: { roomId: shop.roomId } });
    const shopkeeper = t.shopkeeperToken(shop.shopkeeperId);
    const customer = t.customerToken(member.customerId);

    const personal: [string, string][] = [
      ["/api/customers/me", customer],
      ["/api/customers/me/rooms", customer],
      [`/api/rooms/${shop.roomId}/messages`, customer],
      [`/api/rooms/${shop.roomId}/members`, shopkeeper],
      ["/api/notifications/capabilities", shopkeeper],
      ["/api/notifications/schedules", shopkeeper],
      ["/api/notifications/designs", shopkeeper],
    ];
    for (const [path, token] of personal) {
      const res = await t.call("GET", path, { token });
      assert.equal(res.status, 200, path);
      assert.equal(res.headers.get("cache-control"), "no-store", path);
    }
  });

  it("lets send history be cached only briefly, privately", async () => {
    const shop = await createShop(t.prisma);
    const res = await t.call("GET", "/api/notifications/sends", { token: t.shopkeeperToken(shop.shopkeeperId) });
    assert.equal(res.headers.get("cache-control"), "private, max-age=15");
  });
});
