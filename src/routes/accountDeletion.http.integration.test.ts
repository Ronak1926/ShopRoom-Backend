import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import {
  createCustomer,
  createDesign,
  createShop,
  integrationConfigured,
  resetDatabase,
  stubSendEach,
} from "../test/integration.js";
import { startTestApp, type TestApp } from "../test/http.js";
import { hashPassword } from "../utils/password.js";

const enabled = integrationConfigured();
const PASSWORD = "owner-pass-123";

describe("account deletion", { skip: !enabled }, () => {
  let t: TestApp;
  let stub: ReturnType<typeof stubSendEach>;

  before(async () => {
    t = await startTestApp();
  });
  after(() => t.close());
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    t.clearSessionCache();
    t.newClientIp();
    stub = stubSendEach(t.firebaseMessaging);
  });
  afterEach(() => stub.restore());

  async function customerWithData() {
    const shop = await createShop(t.prisma);
    const fixture = await createCustomer(t.prisma, { member: { roomId: shop.roomId } });
    const customerId = fixture.customerId;
    await t.prisma.customer.update({ where: { id: customerId }, data: { passwordHash: await hashPassword(PASSWORD) } });
    await t.prisma.room.update({ where: { id: shop.roomId }, data: { membersCount: { increment: 1 } } });
    await t.prisma.message.create({
      data: { roomId: shop.roomId, senderType: "CUSTOMER", customerId, text: "hello" },
    });
    return { ...shop, customerId, token: t.customerToken(customerId) };
  }

  describe("customers", () => {
    it("refuses without the right password and changes nothing", async () => {
      const c = await customerWithData();
      for (const body of [{}, { password: "wrong-password" }, { idToken: "x".repeat(40) }]) {
        const res = await t.call("DELETE", "/api/customers/me", { token: c.token, body });
        assert.equal(res.status, 403, JSON.stringify(body));
      }
      assert.equal(await t.prisma.customer.count({ where: { id: c.customerId } }), 1);
      assert.equal(await t.prisma.membership.count({ where: { customerId: c.customerId } }), 1);
    });

    it("needs a session to even try", async () => {
      assert.equal((await t.call("DELETE", "/api/customers/me", { body: { password: PASSWORD } })).status, 401);
    });

    it("erases the customer, their data and their access", async () => {
      const c = await customerWithData();
      const other = await createCustomer(t.prisma, { member: { roomId: c.roomId } });
      await t.prisma.room.update({ where: { id: c.roomId }, data: { membersCount: { increment: 1 } } });

      const res = await t.call("DELETE", "/api/customers/me", { token: c.token, body: { password: PASSWORD } });
      assert.equal(res.status, 200, JSON.stringify(res.json));

      const where = { customerId: c.customerId };
      assert.equal(await t.prisma.customer.count({ where: { id: c.customerId } }), 0);
      assert.equal(await t.prisma.membership.count({ where }), 0);
      assert.equal(await t.prisma.message.count({ where }), 0);
      assert.equal(await t.prisma.customerDevice.count({ where }), 0);
      assert.equal((await t.prisma.room.findUniqueOrThrow({ where: { id: c.roomId } })).membersCount, 1, "member counter follows");

      assert.equal(await t.prisma.customer.count({ where: { id: other.customerId } }), 1, "other members are untouched");
      assert.equal((await t.call("GET", "/api/customers/me", { token: c.token })).status, 401);
    });

    it("lets a Google-only account delete itself only with a fresh Google sign-in", async () => {
      const c = await customerWithData();
      await t.prisma.customer.update({
        where: { id: c.customerId },
        data: { passwordHash: null, firebaseUid: "google-uid-1" },
      });
      // A password is no way in for an account that has none…
      assert.equal((await t.call("DELETE", "/api/customers/me", { token: c.token, body: { password: PASSWORD } })).status, 403);
      // …and an ID token that Firebase does not vouch for is no better.
      assert.equal(
        (await t.call("DELETE", "/api/customers/me", { token: c.token, body: { idToken: "not-a-real-id-token-at-all" } })).status,
        403,
      );
      assert.equal(await t.prisma.customer.count({ where: { id: c.customerId } }), 1);
    });
  });

  describe("shopkeepers", () => {
    async function shopWithHistory() {
      const shop = await createShop(t.prisma);
      await t.prisma.shopkeeper.update({
        where: { id: shop.shopkeeperId },
        data: { passwordHash: await hashPassword(PASSWORD) },
      });
      const token = t.shopkeeperToken(shop.shopkeeperId);
      const designId = await createDesign(t.prisma, shop.shopkeeperId);
      const member = await createCustomer(t.prisma, { member: { roomId: shop.roomId } });
      await t.prisma.message.create({
        data: { roomId: shop.roomId, senderType: "SHOPKEEPER", shopkeeperId: shop.shopkeeperId, text: "welcome" },
      });

      const sent = await t.call("POST", "/api/notifications/send", {
        token,
        body: { source: "DESIGN", notificationId: designId, audience: { mode: "ROOM_MEMBERS", radiusKm: 5 }, message: "Hi" },
      });
      assert.equal(sent.status, 201, JSON.stringify(sent.json));

      const scheduled = await t.call("POST", "/api/notifications/schedules", {
        token,
        body: {
          source: "DESIGN",
          notificationId: designId,
          audience: { includeMembers: true, includeNearby: false, radiusKm: 5, includeFutureMembers: true, skipNotificationsOff: true },
          schedule: {
            sendAt: new Date(Date.now() + 3_600_000).toISOString(),
            timeZone: "Asia/Kolkata",
            recurrence: "ONCE",
            repeatEvery: 1,
            weekdays: [],
            endMode: "NEVER",
            endDate: null,
            endAfter: null,
            deliverySpeed: "STANDARD",
          },
        },
      });
      assert.equal(scheduled.status, 201, JSON.stringify(scheduled.json));
      return { ...shop, token, designId, member };
    }

    it("refuses without the right password and changes nothing", async () => {
      const s = await shopWithHistory();
      for (const body of [{}, { password: "wrong-password" }]) {
        const res = await t.call("DELETE", "/api/shopkeeper/me", { token: s.token, body });
        assert.ok([400, 403].includes(res.status), JSON.stringify(body));
      }
      assert.equal(await t.prisma.shopkeeper.count({ where: { id: s.shopkeeperId } }), 1);
      assert.equal(await t.prisma.notificationSend.count({ where: { shopkeeperId: s.shopkeeperId } }), 1);
    });

    it("erases the shop, room, designs, sends and schedules — but not the customers", async () => {
      const s = await shopWithHistory();
      assert.equal(await t.prisma.notificationSendRecipient.count(), 1);

      const res = await t.call("DELETE", "/api/shopkeeper/me", { token: s.token, body: { password: PASSWORD } });
      assert.equal(res.status, 200, JSON.stringify(res.json));

      assert.equal(await t.prisma.shopkeeper.count(), 0);
      assert.equal(await t.prisma.shop.count(), 0);
      assert.equal(await t.prisma.room.count(), 0);
      assert.equal(await t.prisma.membership.count(), 0);
      assert.equal(await t.prisma.message.count(), 0);
      assert.equal(await t.prisma.notificationDesign.count(), 0);
      assert.equal(await t.prisma.notificationDesignVersion.count(), 0);
      assert.equal(await t.prisma.notificationSend.count(), 0);
      assert.equal(await t.prisma.notificationSendRecipient.count(), 0);
      assert.equal(await t.prisma.notificationSchedule.count(), 0);

      assert.equal(await t.prisma.customer.count({ where: { id: s.member.customerId } }), 1);
      const rooms = await t.call("GET", "/api/customers/me/rooms", { token: t.customerToken(s.member.customerId) });
      assert.deepEqual(rooms.json.rooms, []);
      assert.equal((await t.call("GET", "/api/shop/me", { token: s.token })).status, 401);
    });

    it("leaves other shops alone", async () => {
      const s = await shopWithHistory();
      const other = await createShop(t.prisma);
      await createDesign(t.prisma, other.shopkeeperId);

      await t.call("DELETE", "/api/shopkeeper/me", { token: s.token, body: { password: PASSWORD } });
      assert.equal(await t.prisma.shopkeeper.count({ where: { id: other.shopkeeperId } }), 1);
      assert.equal(await t.prisma.room.count({ where: { id: other.roomId } }), 1);
      assert.equal(await t.prisma.notificationDesign.count({ where: { shopkeeperId: other.shopkeeperId } }), 1);
    });
  });
});
