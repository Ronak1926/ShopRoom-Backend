import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import {
  connectTestEnvironment,
  createCustomer,
  createDesign,
  createShop,
  integrationConfigured,
  resetDatabase,
  stubSendEach,
  type TestMessaging,
  type TestPrisma,
} from "../test/integration.js";

const enabled = integrationConfigured();
const NEAR = { latitude: 19.09, longitude: 72.89 };

/**
 * What each plan may do, end to end through the API:
 *   1 Month  — room members only, quick edit (words and photos), template catalog tier 1
 *   2 Months — up to 5 km, full editor without custom animation, tier 2
 *   3 Months — up to 10 km, everything
 */
describe("plan rules", { skip: !enabled }, () => {
  let prisma: TestPrisma;
  let messaging: TestMessaging;
  let server: Server;
  let baseUrl: string;
  let shopkeeperToken: (id: string) => string;
  let runDueSchedules: typeof import("../services/notificationScheduler.service.js").runDueSchedules;
  let stub: ReturnType<typeof stubSendEach>;

  before(async () => {
    ({ prisma, firebaseMessaging: messaging } = await connectTestEnvironment());
    const { app } = await import("../app.js");
    const jwt = await import("../utils/jwt.js");
    ({ runDueSchedules } = await import("../services/notificationScheduler.service.js"));
    shopkeeperToken = (id) => jwt.signShopkeeperToken(id, 0);
    server = createServer(app).listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    stub = stubSendEach(messaging);
  });

  afterEach(() => stub.restore());

  async function call(method: string, path: string, options: { token?: string; body?: unknown } = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  }

  async function shopOn(planType: string) {
    const shop = await createShop(prisma, { planType });
    const designId = await createDesign(prisma, shop.shopkeeperId);
    await createCustomer(prisma, { member: { roomId: shop.roomId } });
    return { ...shop, designId, token: shopkeeperToken(shop.shopkeeperId) };
  }

  const send = (designId: string, mode: "ROOM_MEMBERS" | "NEARBY" | "MEMBERS_NEARBY", radiusKm: number) => ({
    source: "DESIGN",
    notificationId: designId,
    audience: { mode, radiusKm },
  });

  const schedule = (designId: string, includeNearby: boolean, radiusKm: number, inMs: number) => ({
    source: "DESIGN",
    notificationId: designId,
    audience: { includeMembers: true, includeNearby, radiusKm, includeFutureMembers: true, skipNotificationsOff: true },
    schedule: {
      sendAt: new Date(Date.now() + inMs).toISOString(),
      timeZone: "Asia/Kolkata",
      recurrence: "ONCE",
      repeatEvery: 1,
      weekdays: [],
      endMode: "NEVER",
      endDate: null,
      endAfter: null,
      deliverySpeed: "STANDARD",
    },
  });

  describe("how far a send reaches", () => {
    it("keeps a 1 Month plan to room members", async () => {
      const { designId, token } = await shopOn("1m");
      const nearby = await call("POST", "/api/notifications/send", { token, body: send(designId, "NEARBY", 5) });
      assert.equal(nearby.status, 403);
      assert.match(nearby.json.message, /room members only/);
      assert.equal((await call("POST", "/api/notifications/send", { token, body: send(designId, "MEMBERS_NEARBY", 1) })).status, 403);
      assert.equal(stub.messages().length, 0, "nothing goes out on a refused send");
      assert.equal((await call("POST", "/api/notifications/send", { token, body: send(designId, "ROOM_MEMBERS", 25) })).status, 201);
    });

    it("lets 2 Months reach 5 km and 3 Months reach 10 km, and no further", async () => {
      for (const [plan, max] of [["2m", 5], ["3m", 10]] as const) {
        const { designId, token } = await shopOn(plan);
        await createCustomer(prisma, { location: NEAR });
        const tooFar = await call("POST", "/api/notifications/send", { token, body: send(designId, "NEARBY", max + 1) });
        assert.equal(tooFar.status, 403, `${plan} beyond ${max} km`);
        assert.match(tooFar.json.message, new RegExp(`up to ${max} km`));
        assert.equal((await call("POST", "/api/notifications/send", { token, body: send(designId, "NEARBY", max) })).status, 201, `${plan} at ${max} km`);
      }
    });

    it("applies the same limits when scheduling", async () => {
      const { designId, token } = await shopOn("1m");
      const refused = await call("POST", "/api/notifications/schedules", { token, body: schedule(designId, true, 5, 3_600_000) });
      assert.equal(refused.status, 403, JSON.stringify(refused.json));
      const members = await call("POST", "/api/notifications/schedules", { token, body: schedule(designId, false, 5, 3_600_000) });
      assert.equal(members.status, 201, JSON.stringify(members.json));
    });

    it("fits an older schedule to a plan that has since shrunk", async () => {
      const { shopkeeperId, roomId, designId, token } = await shopOn("3m");
      const member = await prisma.membership.findFirstOrThrow({ where: { roomId }, select: { customerId: true } });
      const stranger = await createCustomer(prisma, { location: NEAR });
      const made = await call("POST", "/api/notifications/schedules", { token, body: schedule(designId, true, 10, 120_000) });
      assert.equal(made.status, 201, JSON.stringify(made.json));
      await prisma.shopkeeper.update({ where: { id: shopkeeperId }, data: { planType: "1m" } });

      await runDueSchedules(new Date(Date.now() + 150_000));
      const sendRow = await prisma.notificationSend.findFirstOrThrow({ where: { shopkeeperId }, select: { audience: true, radiusKm: true } });
      assert.deepEqual(sendRow, { audience: "ROOM_MEMBERS", radiusKm: null }, "members only, as 1 Month allows");
      const reached = await prisma.notificationSendRecipient.findMany({ where: { send: { shopkeeperId } }, select: { customerId: true } });
      assert.ok(reached.some((r) => r.customerId === member.customerId), "the member still gets it");
      assert.ok(!reached.some((r) => r.customerId === stranger.customerId), "the nearby stranger does not");
    });

    it("reports the reach in the plan's capabilities", async () => {
      for (const [plan, max] of [["1m", 0], ["2m", 5], ["3m", 10]] as const) {
        const { token } = await shopOn(plan);
        const caps = await call("GET", "/api/notifications/capabilities", { token });
        assert.equal(caps.json.data.capabilities.maxRadiusKm, max, plan);
      }
    });
  });

  describe("editing", () => {
    async function savedDesign(token: string, designId: string) {
      return (await call("GET", `/api/notifications/designs/${designId}`, { token })).json.data.designJson;
    }

    it("lets a 1 Month plan change words but nothing else", async () => {
      const { designId, token } = await shopOn("1m");
      const design = await savedDesign(token, designId);

      design.elements[0].content.text = "Diwali offer";
      assert.equal((await call("PATCH", `/api/notifications/designs/${designId}`, { token, body: { design } })).status, 200);

      const moved = structuredClone(design);
      moved.elements[0].frame.x += 30;
      const refused = await call("PATCH", `/api/notifications/designs/${designId}`, { token, body: { design: moved } });
      assert.equal(refused.status, 403);
      assert.match(refused.json.message, /quick edit/);

      const blank = await call("POST", "/api/notifications/designs", { token, body: { name: "Mine", category: "CUSTOM" } });
      assert.equal(blank.status, 403, "no blank canvas on 1 Month");
      assert.equal((await savedDesign(token, designId)).elements[0].frame.x, design.elements[0].frame.x, "the refused save changed nothing");
    });

    it("gives 2 Months the full editor but not custom animation; 3 Months gets both", async () => {
      for (const plan of ["2m", "3m"]) {
        const { designId, token } = await shopOn(plan);
        const design = await savedDesign(token, designId);
        design.elements[0].frame.x += 30;
        design.elements[0].style = { color: "#FF0000" };
        assert.equal((await call("PATCH", `/api/notifications/designs/${designId}`, { token, body: { design } })).status, 200, `${plan} restyle`);

        design.elements[0].animation = { entry: { type: "POP" } };
        const animated = await call("PATCH", `/api/notifications/designs/${designId}`, { token, body: { design } });
        assert.equal(animated.status, plan === "3m" ? 200 : 403, `${plan} animation`);
        assert.equal((await call("POST", "/api/notifications/designs", { token, body: { name: "Mine", category: "CUSTOM" } })).status, 201, `${plan} blank canvas`);
      }
    });
  });

  describe("templates", () => {
    async function template(slug: string, requiredPlan: string | null) {
      const category = await prisma.notificationCategory.upsert({
        where: { slug: "plan-rules-test" },
        update: {},
        create: { slug: "plan-rules-test", name: "Plan rules test" },
      });
      const now = new Date().toISOString();
      const designJson = {
        schemaVersion: 2, id: slug, name: slug, category: "OFFER", status: "DRAFT",
        canvas: { width: 400, height: 200, background: { type: "SOLID", color: "#000000" } },
        elements: [
          {
            id: "shop", type: "CONTAINER", frame: { x: 14, y: 14, width: 115, height: 22 }, layout: { direction: "row" },
            children: [
              { id: "shop-initial", type: "LABEL", frame: { x: 0, y: 0, width: 16, height: 16 }, content: { text: "R" } },
              { id: "shop-name", type: "TEXT", frame: { x: 0, y: 0, width: 81, height: 14 }, content: { text: "Riya Boutique" } },
            ],
          },
          { id: "label", type: "TEXT", frame: { x: 20, y: 50, width: 200, height: 14 }, content: { text: "Riya Boutique · Combo" } },
        ],
        metadata: { createdAt: now, updatedAt: now, source: "SHOPROOM_TEMPLATE" },
      };
      return prisma.notificationTemplate.upsert({
        where: { slug },
        update: { requiredPlan, designJson, sampleShopName: "Riya Boutique", isActive: true, categoryId: category.id },
        create: { slug, name: slug, categoryId: category.id, designJson, schemaVersion: 2, requiredPlan, sampleShopName: "Riya Boutique" },
        select: { id: true },
      });
    }

    after(async () => {
      await prisma.notificationTemplate.deleteMany({ where: { slug: { startsWith: "plan-rules-" } } });
      await prisma.notificationCategory.deleteMany({ where: { slug: "plan-rules-test" } });
    });

    it("unlocks templates by plan and fills in the shop's own name", async () => {
      const open = await template("plan-rules-open", null);
      const twoMonths = await template("plan-rules-2m", "2m");
      const { token, shopkeeperId } = await shopOn("1m");
      const shopName = (await prisma.shop.findUniqueOrThrow({ where: { ownerId: shopkeeperId }, select: { shopName: true } })).shopName;

      assert.equal((await call("POST", `/api/notifications/templates/${twoMonths.id}/use`, { token })).status, 403);
      const used = await call("POST", `/api/notifications/templates/${open.id}/use`, { token });
      assert.equal(used.status, 201, JSON.stringify(used.json));

      const elements = used.json.data.designJson.elements;
      const pill = elements.find((n: { id: string }) => n.id === "shop");
      assert.equal(pill.children[1].content.text, shopName);
      assert.equal(pill.children[0].content.text, shopName[0].toUpperCase());
      assert.equal(elements.find((n: { id: string }) => n.id === "label").content.text, `${shopName} · Combo`);
    });
  });
});
