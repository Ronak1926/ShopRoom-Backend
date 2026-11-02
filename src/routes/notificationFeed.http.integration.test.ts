import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createCustomer, createDesign, createShop, integrationConfigured, resetDatabase, sampleDesign } from "../test/integration.js";
import { startTestApp, type TestApp } from "../test/http.js";

const enabled = integrationConfigured();
const HOUR = 3_600_000;

describe("customer notification feed", { skip: !enabled }, () => {
  let t: TestApp;
  let token = 0;

  before(async () => {
    t = await startTestApp();
  });
  after(() => t.close());
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    t.clearSessionCache();
    t.newClientIp();
  });

  async function shop() {
    const made = await createShop(t.prisma);
    const designId = await createDesign(t.prisma, made.shopkeeperId);
    const version = await t.prisma.notificationDesignVersion.create({ data: { designId, version: 1, designJson: sampleDesign(), createdBy: made.shopkeeperId } });
    return { ...made, versionId: version.id };
  }
  async function send(s: Awaited<ReturnType<typeof shop>>, hoursAgo: number, message: string, status: "SENT" | "FAILED" = "SENT") {
    return t.prisma.notificationSend.create({
      data: { shopkeeperId: s.shopkeeperId, roomId: s.roomId, designVersionId: s.versionId, status, message, createdAt: new Date(Date.now() - hoursAgo * HOUR) },
    });
  }
  async function deliver(sendId: string, who: { customerId: string; deviceIds: string[] }, opts: { device?: number; opened?: boolean; status?: "SENT" | "FAILED" | "QUEUED" } = {}) {
    token += 1;
    return t.prisma.notificationSendRecipient.create({
      data: {
        sendId,
        customerId: who.customerId,
        deviceId: who.deviceIds[opts.device ?? 0],
        receiptToken: `feed-token-${token}`,
        status: opts.status ?? "SENT",
        openedAt: opts.opened ? new Date() : null,
      },
    });
  }
  const feed = async (customerId: string) => (await t.call("GET", "/api/notifications/feed", { token: t.customerToken(customerId) })).json.data;

  it("lists the pushes addressed to the customer, newest first, with what the bell needs", async () => {
    const s = await shop();
    const me = await createCustomer(t.prisma, { member: { roomId: s.roomId }, devices: 1 });
    const older = await send(s, 5, "older");
    const newer = await send(s, 1, "newer");
    await deliver(older.id, me, { opened: true });
    await deliver(newer.id, me);

    const data = await feed(me.customerId);
    assert.deepEqual(data.items.map((i: { message: string }) => i.message), ["newer", "older"]);
    assert.deepEqual(data.items.map((i: { read: boolean }) => i.read), [false, true]);
    assert.equal(data.unread, 1);
    const first = data.items[0];
    assert.equal(first.sendId, newer.id);
    assert.equal(first.roomId, s.roomId);
    assert.ok(first.shopName);
    assert.match(first.receiptToken, /^feed-token-/);
    assert.ok(!Number.isNaN(Date.parse(first.sentAt)));
  });

  it("shows a send once even when the customer has several devices, read if any device opened it", async () => {
    const s = await shop();
    const me = await createCustomer(t.prisma, { member: { roomId: s.roomId }, devices: 2 });
    const one = await send(s, 1, "on two phones");
    await deliver(one.id, me, { device: 0 });
    await deliver(one.id, me, { device: 1, opened: true });
    const data = await feed(me.customerId);
    assert.equal(data.items.length, 1);
    assert.equal(data.items[0].read, true);
    assert.equal(data.unread, 0);
  });

  it("leaves out pushes that failed, are not theirs, or are older than 30 days", async () => {
    const s = await shop();
    const me = await createCustomer(t.prisma, { member: { roomId: s.roomId }, devices: 1 });
    const other = await createCustomer(t.prisma, { member: { roomId: s.roomId }, devices: 1 });
    const failedSend = await send(s, 1, "send failed", "FAILED");
    const failedDevice = await send(s, 1, "device failed");
    const old = await send(s, 31 * 24, "too old");
    const theirs = await send(s, 1, "for someone else");
    const mine = await send(s, 2, "mine");
    await deliver(failedSend.id, me);
    await deliver(failedDevice.id, me, { status: "FAILED" });
    await deliver(old.id, me);
    await deliver(theirs.id, other);
    await deliver(mine.id, me);
    assert.deepEqual((await feed(me.customerId)).items.map((i: { message: string }) => i.message), ["mine"]);
  });

  it("caps the list at 20", async () => {
    const s = await shop();
    const me = await createCustomer(t.prisma, { member: { roomId: s.roomId }, devices: 1 });
    for (let i = 0; i < 25; i += 1) await deliver((await send(s, i + 1, `n${i}`)).id, me);
    const data = await feed(me.customerId);
    assert.equal(data.items.length, 20);
    assert.equal(data.items[0].message, "n0");
  });

  it("is empty for a customer with nothing, and needs a customer session", async () => {
    const me = await createCustomer(t.prisma);
    assert.deepEqual(await feed(me.customerId), { items: [], unread: 0 });
    assert.equal((await t.call("GET", "/api/notifications/feed")).status, 401);
    const s = await shop();
    assert.equal((await t.call("GET", "/api/notifications/feed", { token: t.shopkeeperToken(s.shopkeeperId) })).status, 401, "a shopkeeper token is not a customer session");
  });
});
