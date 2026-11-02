import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  MUMBAI,
  connectTestEnvironment,
  createCustomer,
  createDesign,
  createShop,
  integrationConfigured,
  resetDatabase,
  sampleDesign,
  type TestPrisma,
} from "../test/integration.js";

const enabled = integrationConfigured();
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

describe("data retention", { skip: !enabled }, () => {
  let prisma: TestPrisma;
  let retention: typeof import("./dataRetention.service.js");

  before(async () => {
    ({ prisma } = await connectTestEnvironment());
    retention = await import("./dataRetention.service.js");
  });
  after(() => prisma.$disconnect());
  beforeEach(async () => {
    await resetDatabase(prisma);
    await prisma.emailOtp.deleteMany();
  });

  it("deletes email OTP rows a day after they expire, and only those", async () => {
    const row = (email: string, expiresAt: Date) => ({ email, code: "digest", expiresAt });
    await prisma.emailOtp.createMany({
      data: [row("old@example.test", daysAgo(2)), row("recent@example.test", daysAgo(0.5)), row("live@example.test", new Date(Date.now() + 600_000))],
    });
    const result = await retention.purgeExpiredData();
    assert.equal(result.emailOtps, 1);
    const left = (await prisma.emailOtp.findMany({ select: { email: true } })).map((r) => r.email).sort();
    assert.deepEqual(left, ["live@example.test", "recent@example.test"]);
  });

  it("erases positions that haven't been refreshed in a month, keeping fresh ones", async () => {
    const stale = await createCustomer(prisma, { location: MUMBAI, locationAgeHours: 40 * 24 });
    const fresh = await createCustomer(prisma, { location: MUMBAI, locationAgeHours: 2 });
    const result = await retention.purgeExpiredData();
    assert.equal(result.stalePositions, 1);

    const staleRow = await prisma.customer.findUniqueOrThrow({ where: { id: stale.customerId } });
    assert.equal(staleRow.latitude, null);
    assert.equal(staleRow.longitude, null);
    assert.equal(staleRow.locationUpdatedAt, null);
    assert.equal(staleRow.allowLocationAccess, true, "consent itself is the customer's to change");

    const freshRow = await prisma.customer.findUniqueOrThrow({ where: { id: fresh.customerId } });
    assert.equal(freshRow.latitude, MUMBAI.latitude);
  });

  it("drops old per-device delivery rows but keeps the send and its counters", async () => {
    const shop = await createShop(prisma);
    const member = await createCustomer(prisma, { member: { roomId: shop.roomId } });
    const designId = await createDesign(prisma, shop.shopkeeperId);
    const version = await prisma.notificationDesignVersion.create({
      data: { designId, version: 1, designJson: sampleDesign(), createdBy: shop.shopkeeperId },
    });
    const send = await prisma.notificationSend.create({
      data: {
        shopkeeperId: shop.shopkeeperId,
        roomId: shop.roomId,
        designVersionId: version.id,
        status: "SENT",
        recipientCount: 2,
        deliveredCount: 2,
      },
    });
    const recipient = (token: string, createdAt: Date, deviceId: string) => ({
      sendId: send.id,
      customerId: member.customerId,
      deviceId,
      receiptToken: token,
      createdAt,
    });
    const second = await prisma.customerDevice.create({
      data: { customerId: member.customerId, fcmToken: `second-${Date.now()}-token-value` },
    });
    await prisma.notificationSendRecipient.createMany({
      data: [
        recipient("old-token", daysAgo(200), member.deviceIds[0]),
        recipient("new-token", daysAgo(10), second.id),
      ],
    });

    const result = await retention.purgeExpiredData();
    assert.equal(result.deliveryRecords, 1);
    const left = await prisma.notificationSendRecipient.findMany({ select: { receiptToken: true } });
    assert.deepEqual(left.map((r) => r.receiptToken), ["new-token"]);
    const kept = await prisma.notificationSend.findUniqueOrThrow({ where: { id: send.id } });
    assert.equal(kept.deliveredCount, 2);
  });

  it("removes devices that haven't checked in for 270 days", async () => {
    const shop = await createShop(prisma);
    const active = await createCustomer(prisma, { member: { roomId: shop.roomId }, devices: 1 });
    const dormant = await createCustomer(prisma, { member: { roomId: shop.roomId }, devices: 1 });
    await prisma.customerDevice.update({ where: { id: dormant.deviceIds[0] }, data: { lastSeenAt: daysAgo(300) } });

    const result = await retention.purgeExpiredData();
    assert.equal(result.inactiveDevices, 1);
    assert.equal(await prisma.customerDevice.count({ where: { id: active.deviceIds[0] } }), 1);
    assert.equal(await prisma.customerDevice.count({ where: { id: dormant.deviceIds[0] } }), 0);
  });

  it("removes rate-limit counters an hour after their window ended, and only those", async () => {
    await prisma.rateLimitCounter.deleteMany();
    // Inserted with SQL: a JS Date written to a timestamptz through the model API is shifted by the session's UTC offset.
    await prisma.$executeRaw`
      INSERT INTO "RateLimitCounter" ("key", "hits", "resetAt") VALUES
        ('t:long-expired', 5, now() - interval '2 hours'),
        ('t:just-expired', 5, now() - interval '1 minute'),
        ('t:active', 5, now() + interval '10 minutes')`;
    const result = await retention.purgeExpiredData();
    assert.equal(result.rateLimitCounters, 1);
    const left = (await prisma.rateLimitCounter.findMany({ select: { key: true } })).map((r) => r.key).sort();
    assert.deepEqual(left, ["t:active", "t:just-expired"]);
    await prisma.rateLimitCounter.deleteMany();
  });

  it("is a no-op on a clean database", async () => {
    assert.deepEqual(await retention.purgeExpiredData(), {
      rateLimitCounters: 0,
      emailOtps: 0,
      stalePositions: 0,
      deliveryRecords: 0,
      inactiveDevices: 0,
    });
  });
});
