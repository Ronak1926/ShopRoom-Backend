import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createCustomer, createDesign, createShop, integrationConfigured, resetDatabase } from "../test/integration.js";
import { startTestApp, type TestApp } from "../test/http.js";
import { encryptText } from "../utils/crypto.js";
import { hashPassword } from "../utils/password.js";

const enabled = integrationConfigured();
const PASSWORD = "owner-pass-123";

describe("downloading your data", { skip: !enabled }, () => {
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

  async function customerWithHistory() {
    const shop = await createShop(t.prisma);
    const me = await createCustomer(t.prisma, { member: { roomId: shop.roomId }, location: { latitude: 19.07, longitude: 72.87 } });
    const neighbour = await createCustomer(t.prisma, { member: { roomId: shop.roomId } });
    await t.prisma.customer.update({ where: { id: me.customerId }, data: { passwordHash: await hashPassword(PASSWORD), fullName: "Asha Rao", firebaseUid: "google-secret-uid" } });
    const mine = await t.prisma.message.create({ data: { roomId: shop.roomId, senderType: "CUSTOMER", customerId: me.customerId, text: encryptText("Is the blue kurta in stock?") } });
    await t.prisma.message.create({ data: { roomId: shop.roomId, senderType: "CUSTOMER", customerId: me.customerId, text: encryptText("oops wrong chat"), deletedForEveryone: true } });
    await t.prisma.message.create({ data: { roomId: shop.roomId, senderType: "CUSTOMER", customerId: neighbour.customerId, text: encryptText("neighbour's private words") } });
    await t.prisma.messageReaction.create({ data: { messageId: mine.id, viewerKey: me.customerId, customerId: me.customerId, emoji: "👍" } });
    await t.prisma.roomViewerState.create({ data: { roomId: shop.roomId, viewerKey: me.customerId, customerId: me.customerId, lastReadAt: new Date() } });
    const device = await t.prisma.customerDevice.findFirstOrThrow({ where: { customerId: me.customerId } });
    return { shop, me, neighbour, device, token: t.customerToken(me.customerId) };
  }

  const shopNameOf = async (shopkeeperId: string) => (await t.prisma.shop.findUniqueOrThrow({ where: { ownerId: shopkeeperId }, select: { shopName: true } })).shopName;

  const exportCustomer = (token: string | undefined, body: unknown = { password: PASSWORD }) => t.call("POST", "/api/customers/me/export", { token, body });

  describe("customers", () => {
    it("needs a session, and the password again", async () => {
      const c = await customerWithHistory();
      assert.equal((await exportCustomer(undefined)).status, 401);
      for (const body of [{ password: "wrong-password" }, { idToken: "x".repeat(40) }]) {
        const res = await exportCustomer(c.token, body);
        assert.equal(res.status, 403, JSON.stringify(body));
        assert.deepEqual(res.json, { message: "Could not confirm your identity" }, "no data leaks into a refusal");
      }
      assert.equal((await exportCustomer(c.token, {})).status, 403, "a session on its own is not enough");
      assert.equal((await exportCustomer(c.token, { password: 5 })).status, 400);
    });

    it("hands back their own data as a download that is never cached", async () => {
      const c = await customerWithHistory();
      const res = await exportCustomer(c.token);
      assert.equal(res.status, 200, JSON.stringify(res.json));
      assert.match(res.headers.get("content-disposition") ?? "", /^attachment; filename="shoproom-customer-data-\d{4}-\d{2}-\d{2}\.json"$/);
      assert.equal(res.headers.get("cache-control"), "no-store");
      assert.match(res.headers.get("content-type") ?? "", /^application\/json/);

      const data = res.json;
      assert.equal(data.format, "shoproom-customer-export-v1");
      assert.equal(data.account.fullName, "Asha Rao");
      assert.deepEqual(data.account.signInMethods, ["password", "google"]);
      assert.deepEqual([data.location.sharingEnabled, data.location.latitude, data.location.longitude], [true, 19.07, 72.87]);
      assert.deepEqual(data.rooms.map((r: { shop: string }) => r.shop), [await shopNameOf(c.shop.shopkeeperId)]);
      const texts = data.messages.map((m: { text: string }) => m.text);
      assert.deepEqual(texts, ["Is the blue kurta in stock?", ""], "readable, and a message deleted for everyone stays empty");
      assert.equal(data.reactions[0].emoji, "👍");
      assert.equal(data.chatReadState.length, 1);
      assert.equal(data.devices.length, 1);
      assert.deepEqual(Object.values(data.truncated), [false, false, false, false, false, false]);
    });

    it("lets the site read the download's file name from another origin", async () => {
      const c = await customerWithHistory();
      const res = await t.call("POST", "/api/customers/me/export", { token: c.token, body: { password: PASSWORD }, headers: { Origin: "http://localhost:3000" } });
      assert.equal(res.status, 200);
      assert.match(res.headers.get("access-control-expose-headers") ?? "", /Content-Disposition/i);
    });

    it("never includes credentials, push tokens, or anyone else's data", async () => {
      const c = await customerWithHistory();
      const stored = await t.prisma.customer.findUniqueOrThrow({ where: { id: c.me.customerId }, select: { passwordHash: true } });
      const device = await t.prisma.customerDevice.findUniqueOrThrow({ where: { id: c.device.id }, select: { fcmToken: true } });
      const neighbour = await t.prisma.customer.findUniqueOrThrow({ where: { id: c.neighbour.customerId }, select: { email: true, fullName: true } });

      const body = JSON.stringify((await exportCustomer(c.token)).json);
      for (const secret of [stored.passwordHash, "google-secret-uid", device.fcmToken, neighbour.email, neighbour.fullName, "neighbour's private words", "tokenVersion"]) {
        assert.ok(secret && !body.includes(secret), `the export must not contain ${secret?.slice(0, 20)}`);
      }
    });

    it("reports what each notification did, for this person only", async () => {
      const c = await customerWithHistory();
      const shopkeeperId = (await t.prisma.shop.findFirstOrThrow({ where: { room: { id: c.shop.roomId } } })).ownerId;
      const designId = await createDesign(t.prisma, shopkeeperId);
      const version = await t.prisma.notificationDesignVersion.create({ data: { designId, version: 1, designJson: {}, createdBy: shopkeeperId } });
      const send = await t.prisma.notificationSend.create({ data: { shopkeeperId, roomId: c.shop.roomId, designVersionId: version.id, status: "SENT" } });
      await t.prisma.notificationSendRecipient.createMany({
        data: [
          { sendId: send.id, customerId: c.me.customerId, deviceId: c.device.id, receiptToken: "tok-mine", status: "SENT", deliveredAt: new Date(), openedAt: new Date() },
          { sendId: send.id, customerId: c.neighbour.customerId, receiptToken: "tok-theirs", status: "SENT" },
        ],
      });
      const { json } = await exportCustomer(c.token);
      assert.equal(json.notificationsReceived.length, 1);
      assert.equal(json.notificationsReceived[0].shop, await shopNameOf(c.shop.shopkeeperId));
      assert.ok(json.notificationsReceived[0].openedAt);
      assert.ok(!JSON.stringify(json).includes("tok-mine"), "receipt tokens are capabilities, not data");
    });

    it("cannot be used by a Google-only account without a genuine fresh sign-in", async () => {
      const c = await customerWithHistory();
      await t.prisma.customer.update({ where: { id: c.me.customerId }, data: { passwordHash: null } });
      assert.equal((await exportCustomer(c.token, { password: PASSWORD })).status, 403);
      assert.equal((await exportCustomer(c.token, { idToken: "not-a-real-id-token-at-all" })).status, 403);
    });

    it("is rate limited per account, so a leaked session cannot be used to drain it repeatedly", async () => {
      const c = await customerWithHistory();
      const statuses: number[] = [];
      for (let i = 0; i < 7; i += 1) statuses.push((await exportCustomer(c.token)).status);
      assert.equal(statuses.filter((s) => s === 200).length, 5);
      assert.deepEqual(statuses.slice(5), [429, 429]);
    });

    it("changes nothing", async () => {
      const c = await customerWithHistory();
      const counts = async () => [await t.prisma.message.count(), await t.prisma.customerDevice.count(), await t.prisma.membership.count()];
      const before = await counts();
      await exportCustomer(c.token);
      assert.deepEqual(await counts(), before);
    });
  });

  describe("shopkeepers", () => {
    async function shopWithHistory() {
      const shop = await createShop(t.prisma);
      const member = await createCustomer(t.prisma, { member: { roomId: shop.roomId } });
      const memberRow = await t.prisma.customer.findUniqueOrThrow({ where: { id: member.customerId }, select: { email: true, fullName: true } });
      await t.prisma.shopkeeper.update({ where: { id: shop.shopkeeperId }, data: { passwordHash: await hashPassword(PASSWORD), ownerName: "Ravi Shah" } });
      await t.prisma.room.update({ where: { id: shop.roomId }, data: { membersCount: 1 } });
      await createDesign(t.prisma, shop.shopkeeperId);
      await t.prisma.planPayment.create({
        data: { shopkeeperId: shop.shopkeeperId, purpose: "REGISTRATION", planType: "2m", amount: 59_900, razorpayOrderId: "order_X1", razorpayPaymentId: "pay_X1" },
      });
      await t.prisma.message.create({ data: { roomId: shop.roomId, senderType: "SHOPKEEPER", shopkeeperId: shop.shopkeeperId, text: encryptText("New stock on Friday") } });
      return { ...shop, memberRow, token: t.shopkeeperToken(shop.shopkeeperId) };
    }
    const exportShop = (token: string | undefined, body: unknown = { password: PASSWORD }) => t.call("POST", "/api/shopkeeper/me/export", { token, body });

    it("needs a session, and the password again", async () => {
      const s = await shopWithHistory();
      assert.equal((await exportShop(undefined)).status, 401);
      assert.equal((await exportShop(s.token, { password: "wrong-password" })).status, 403);
      assert.equal((await exportShop(s.token, {})).status, 400);
    });

    it("hands back the shop, plan, payments, designs and their own messages", async () => {
      const s = await shopWithHistory();
      const res = await exportShop(s.token);
      assert.equal(res.status, 200, JSON.stringify(res.json));
      assert.match(res.headers.get("content-disposition") ?? "", /^attachment; filename="shoproom-shopkeeper-data-/);
      assert.equal(res.headers.get("cache-control"), "no-store");
      const data = res.json;
      assert.equal(data.account.ownerName, "Ravi Shah");
      assert.equal(data.shop.name, await shopNameOf(s.shopkeeperId));
      assert.equal(data.room.membersCount, 1);
      assert.deepEqual(data.payments.map((p: { amountPaise: number; razorpayPaymentId: string }) => [p.amountPaise, p.razorpayPaymentId]), [[59_900, "pay_X1"]]);
      assert.equal(data.notificationDesigns.length, 1);
      assert.ok(data.notificationDesigns[0].designJson);
      assert.deepEqual(data.chatMessages.map((m: { text: string }) => m.text), ["New stock on Friday"]);
      assert.ok(data.notificationPreferences);
    });

    it("leaves out credentials and the members' personal data", async () => {
      const s = await shopWithHistory();
      const stored = await t.prisma.shopkeeper.findUniqueOrThrow({ where: { id: s.shopkeeperId }, select: { passwordHash: true } });
      const body = JSON.stringify((await exportShop(s.token)).json);
      for (const secret of [stored.passwordHash, s.memberRow.email, s.memberRow.fullName, "tokenVersion"]) {
        assert.ok(secret && !body.includes(secret), `the export must not contain ${secret?.slice(0, 20)}`);
      }
    });

    it("never includes another shop's data", async () => {
      const mine = await shopWithHistory();
      const other = await createShop(t.prisma);
      await createDesign(t.prisma, other.shopkeeperId);
      await t.prisma.planPayment.create({ data: { shopkeeperId: other.shopkeeperId, purpose: "RENEWAL", planType: "1m", amount: 39_900, razorpayOrderId: "order_Y1", razorpayPaymentId: "pay_Y1" } });
      const body = JSON.stringify((await exportShop(mine.token)).json);
      assert.ok(!body.includes("pay_Y1") && !body.includes(await shopNameOf(other.shopkeeperId)));
    });

    it("is rate limited per account", async () => {
      const s = await shopWithHistory();
      const statuses: number[] = [];
      for (let i = 0; i < 6; i += 1) statuses.push((await exportShop(s.token)).status);
      assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
    });
  });
});
