import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import {
  connectTestEnvironment,
  createCustomer,
  createDesign,
  createShop,
  integrationConfigured,
  resetDatabase,
  sampleDesign,
  stubSendEach,
  type TestMessaging,
  type TestPrisma,
} from "../test/integration.js";
import { NotificationError } from "../utils/notificationError.js";

const enabled = integrationConfigured();
const HERO_URL = "https://res.cloudinary.com/demo/image/upload/hero.jpg";

describe("sendNotification", { skip: !enabled }, () => {
  let prisma: TestPrisma;
  let messaging: TestMessaging;
  let sendNotification: typeof import("./notificationSend.service.js").sendNotification;
  let recordReceipt: typeof import("./notificationReceipt.service.js").recordReceipt;
  let getSendDesign: typeof import("./notificationDelivery.service.js").getSendDesign;
  let stub: ReturnType<typeof stubSendEach>;

  before(async () => {
    ({ prisma, firebaseMessaging: messaging } = await connectTestEnvironment());
    ({ sendNotification } = await import("./notificationSend.service.js"));
    ({ recordReceipt } = await import("./notificationReceipt.service.js"));
    ({ getSendDesign } = await import("./notificationDelivery.service.js"));
  });

  after(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    stub = stubSendEach(messaging);
  });

  afterEach(() => stub.restore());

  const toMembers = (designId: string, message?: string) => ({
    source: "DESIGN" as const,
    notificationId: designId,
    audience: { mode: "ROOM_MEMBERS" as const, radiusKm: 10 },
    message,
  });

  it("delivers a data-only push to every device with its own receipt token", async () => {
    const { shopkeeperId, roomId } = await createShop(prisma);
    const designId = await createDesign(prisma, shopkeeperId, { imageUrl: HERO_URL });
    const a = await createCustomer(prisma, { member: { roomId }, devices: 2 });
    const b = await createCustomer(prisma, { member: { roomId } });

    const result = await sendNotification(shopkeeperId, toMembers(designId, "  Flat 50% off  "));
    assert.equal(result.recipients, 3);

    const sent = stub.messages();
    assert.equal(sent.length, 3);
    assert.deepEqual(
      sent.map((m) => (m as { token: string }).token).sort(),
      [...a.tokens, ...b.tokens].sort(),
    );
    for (const message of sent) {
      assert.ok(!("notification" in message), "must stay data-only so the SW controls display");
      const data = message.data as Record<string, string>;
      assert.equal(data.type, "DESIGN_PUSH");
      assert.equal(data.sendId, result.id);
      assert.equal(data.roomId, roomId);
      assert.equal(data.body, "Flat 50% off");
      assert.equal(data.imageUrl, HERO_URL);
      assert.match(data.rt, /^[0-9a-f-]{36}$/);
    }
    assert.equal(new Set(sent.map((m) => m.data?.rt)).size, 3, "one receipt token per device");

    const send = await prisma.notificationSend.findUniqueOrThrow({ where: { id: result.id } });
    assert.equal(send.status, "SENT");
    assert.equal(send.recipientCount, 3);
    assert.equal(send.successCount, 3);
    assert.equal(send.audience, "ROOM_MEMBERS");
    assert.ok(send.sentAt);

    const rows = await prisma.notificationSendRecipient.findMany({ where: { sendId: result.id } });
    assert.equal(rows.length, 3);
    assert.ok(rows.every((r) => r.status === "SENT"));
  });

  it("omits the hero image when the design has none", async () => {
    const { shopkeeperId, roomId } = await createShop(prisma);
    const designId = await createDesign(prisma, shopkeeperId);
    await createCustomer(prisma, { member: { roomId } });
    await sendNotification(shopkeeperId, toMembers(designId));
    assert.equal(stub.messages()[0].data?.imageUrl, undefined);
    assert.match(stub.messages()[0].data?.body ?? "", /favourite shop/);
  });

  it("marks priority-free sends as normal urgency with a 24h expiry", async () => {
    const { shopkeeperId, roomId } = await createShop(prisma);
    const designId = await createDesign(prisma, shopkeeperId);
    await createCustomer(prisma, { member: { roomId } });
    await sendNotification(shopkeeperId, toMembers(designId));
    const headers = (stub.messages()[0] as { webpush?: { headers?: Record<string, string> } })
      .webpush?.headers;
    assert.equal(headers?.Urgency, "normal");
    assert.equal(headers?.TTL, "86400");
  });

  it("removes dead tokens, records the failure and still reports the rest as sent", async () => {
    await resetDatabase(prisma);
    stub.restore();
    const { shopkeeperId, roomId } = await createShop(prisma);
    const designId = await createDesign(prisma, shopkeeperId);
    const alive = await createCustomer(prisma, { member: { roomId } });
    const dead = await createCustomer(prisma, { member: { roomId } });
    const flaky = await createCustomer(prisma, { member: { roomId } });
    stub = stubSendEach(messaging, (m) => {
      const token = (m as { token: string }).token;
      if (token === dead.tokens[0]) {
        return { success: false, code: "messaging/registration-token-not-registered" };
      }
      if (token === flaky.tokens[0]) return { success: false, code: "messaging/quota-exceeded" };
      return { success: true };
    });

    const result = await sendNotification(shopkeeperId, toMembers(designId));
    const send = await prisma.notificationSend.findUniqueOrThrow({ where: { id: result.id } });
    assert.equal(send.successCount, 1);
    assert.equal(send.failureCount, 2);
    assert.equal(send.status, "SENT");

    assert.equal(await prisma.customerDevice.count({ where: { id: dead.deviceIds[0] } }), 0);
    assert.equal(await prisma.customerDevice.count({ where: { id: flaky.deviceIds[0] } }), 1);
    assert.equal(await prisma.customerDevice.count({ where: { id: alive.deviceIds[0] } }), 1);

    const byCustomer = async (customerId: string) =>
      prisma.notificationSendRecipient.findFirstOrThrow({
        where: { sendId: result.id, customerId },
      });
    assert.equal((await byCustomer(alive.customerId)).status, "SENT");
    const deadRow = await byCustomer(dead.customerId);
    assert.equal(deadRow.status, "FAILED");
    assert.equal(deadRow.errorCode, "messaging/registration-token-not-registered");
    assert.equal(deadRow.deviceId, null, "device link cleared when the device is removed");
  });

  it("splits a large audience into FCM batches of at most 500 and reaches every device once", async () => {
    await resetDatabase(prisma);
    const { shopkeeperId, roomId } = await createShop(prisma);
    const designId = await createDesign(prisma, shopkeeperId);
    const crowd = await createCustomer(prisma, { member: { roomId }, devices: 1_100 });

    const result = await sendNotification(shopkeeperId, toMembers(designId));

    assert.equal(result.recipients, 1_100);
    assert.deepEqual(stub.batches.map((b) => b.length).sort((a, b) => b - a), [500, 500, 100]);
    const tokens = stub.messages().map((m) => (m as { token: string }).token);
    assert.equal(new Set(tokens).size, 1_100, "no device is sent to twice");
    assert.deepEqual([...new Set(tokens)].sort(), [...crowd.tokens].sort());
    const send = await prisma.notificationSend.findUniqueOrThrow({ where: { id: result.id } });
    assert.equal(send.successCount, 1_100);
    assert.equal(await prisma.notificationSendRecipient.count({ where: { sendId: result.id } }), 1_100);
  });

  it("records a FAILED send instead of crashing when FCM itself throws", async () => {
    const { shopkeeperId, roomId } = await createShop(prisma);
    const designId = await createDesign(prisma, shopkeeperId);
    await createCustomer(prisma, { member: { roomId } });
    // afterEach's stub.restore() puts the original method back.
    (messaging as { sendEach: unknown }).sendEach = async () => {
      throw new Error("network down");
    };

    const result = await sendNotification(shopkeeperId, toMembers(designId));
    const send = await prisma.notificationSend.findUniqueOrThrow({ where: { id: result.id } });
    assert.equal(send.status, "FAILED");
    assert.equal(send.failureReason, "ALL_DELIVERIES_FAILED");
    assert.equal(send.failureCount, 1);
  });

  it("returns 0 recipients and a FAILED send when nobody can be reached", async () => {
    const { shopkeeperId } = await createShop(prisma);
    const designId = await createDesign(prisma, shopkeeperId);
    const result = await sendNotification(shopkeeperId, toMembers(designId));
    assert.equal(result.recipients, 0);
    const send = await prisma.notificationSend.findUniqueOrThrow({ where: { id: result.id } });
    assert.equal(send.status, "FAILED");
    assert.equal(send.failureReason, "NO_RECIPIENTS");
    assert.equal(stub.messages().length, 0);
  });

  it("refuses a distance audience when the shop has no saved location", async () => {
    const { shopkeeperId } = await createShop(prisma, { location: null });
    const designId = await createDesign(prisma, shopkeeperId);
    await assert.rejects(
      () =>
        sendNotification(shopkeeperId, {
          source: "DESIGN",
          notificationId: designId,
          audience: { mode: "NEARBY", radiusKm: 5 },
        }),
      (err: unknown) => err instanceof NotificationError && err.status === 400,
    );
    assert.equal(await prisma.notificationSend.count(), 0);
  });

  it("will not send another design owned by a different shopkeeper", async () => {
    const mine = await createShop(prisma);
    const theirs = await createShop(prisma);
    const theirDesign = await createDesign(prisma, theirs.shopkeeperId);
    await createCustomer(prisma, { member: { roomId: mine.roomId } });
    await assert.rejects(
      () => sendNotification(mine.shopkeeperId, toMembers(theirDesign)),
      (err: unknown) => err instanceof NotificationError && err.status === 404,
    );
    assert.equal(stub.messages().length, 0);
  });

  it("freezes the design: editing it afterwards does not change what was delivered", async () => {
    const { shopkeeperId, roomId } = await createShop(prisma);
    const designId = await createDesign(prisma, shopkeeperId, { imageUrl: HERO_URL });
    const member = await createCustomer(prisma, { member: { roomId } });
    const result = await sendNotification(shopkeeperId, toMembers(designId));

    await prisma.notificationDesign.update({
      where: { id: designId },
      data: { designJson: { ...sampleDesign(), name: "Edited later" } },
    });

    const delivered = await getSendDesign(member.customerId, result.id);
    assert.equal((delivered.designJson as { name: string }).name, "Test banner");
  });

  it("gives concurrent sends of one design distinct pinned versions (double-click)", async () => {
    const { pinDesignVersion } = await import("./notificationDesignPin.service.js");
    const { shopkeeperId } = await createShop(prisma);
    const designId = await createDesign(prisma, shopkeeperId);

    const pins = await Promise.all(
      Array.from({ length: 6 }, () => pinDesignVersion(shopkeeperId, designId)),
    );
    assert.equal(new Set(pins.map((p) => p.designVersionId)).size, 6);
    const versions = await prisma.notificationDesignVersion.findMany({
      where: { designId },
      select: { version: true },
    });
    assert.equal(new Set(versions.map((v) => v.version)).size, 6);
  });

  describe("daily limit", () => {
    it("blocks the send that would exceed the plan's limit", async () => {
      const { shopkeeperId, roomId } = await createShop(prisma, { planType: "1m" }); // 1 / day
      const designId = await createDesign(prisma, shopkeeperId);
      await createCustomer(prisma, { member: { roomId } });

      await sendNotification(shopkeeperId, toMembers(designId));
      await assert.rejects(
        () => sendNotification(shopkeeperId, toMembers(designId)),
        (err: unknown) =>
          err instanceof NotificationError && err.status === 429 && /today's limit/.test(err.message),
      );
      assert.equal(await prisma.notificationSend.count(), 1);
    });

    it("lets exactly the allowed number through when reservations race", async () => {
      // Hits reserveSend directly: the full send path serialises callers on the
      // design row while pinning, which would hide a missing lock.
      const { reserveSend } = await import("./notificationUsage.service.js");
      const { shopkeeperId, roomId } = await createShop(prisma, { planType: "2m" }); // 2 / day
      const designId = await createDesign(prisma, shopkeeperId);
      const { pinDesignVersion } = await import("./notificationDesignPin.service.js");
      const { designVersionId } = await pinDesignVersion(shopkeeperId, designId);

      const outcomes = await Promise.allSettled(
        Array.from({ length: 12 }, () =>
          reserveSend(
            {
              shopkeeperId,
              roomId,
              designVersionId,
              audience: "ROOM_MEMBERS",
              radiusKm: null,
              message: null,
            },
            "2m",
          ),
        ),
      );
      assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 2);
      assert.equal(await prisma.notificationSend.count(), 2);
      for (const o of outcomes) {
        if (o.status === "rejected") {
          assert.ok(o.reason instanceof NotificationError && o.reason.status === 429);
        }
      }
    });

    it("does not spend the allowance on a send that reached nobody", async () => {
      const { shopkeeperId, roomId } = await createShop(prisma, { planType: "1m" });
      const designId = await createDesign(prisma, shopkeeperId);

      await sendNotification(shopkeeperId, toMembers(designId)); // empty room → FAILED
      await createCustomer(prisma, { member: { roomId } });
      const second = await sendNotification(shopkeeperId, toMembers(designId));
      assert.equal(second.recipients, 1);
    });

    it("does not count another shop's sends", async () => {
      const a = await createShop(prisma, { planType: "1m" });
      const b = await createShop(prisma, { planType: "1m" });
      const designA = await createDesign(prisma, a.shopkeeperId);
      const designB = await createDesign(prisma, b.shopkeeperId);
      await createCustomer(prisma, { member: { roomId: a.roomId } });
      await createCustomer(prisma, { member: { roomId: b.roomId } });
      await sendNotification(a.shopkeeperId, toMembers(designA));
      await assert.doesNotReject(() => sendNotification(b.shopkeeperId, toMembers(designB)));
    });
  });

  describe("delivery receipts", () => {
    async function sentTo(count = 1) {
      const { shopkeeperId, roomId } = await createShop(prisma);
      const designId = await createDesign(prisma, shopkeeperId);
      const customers = await Promise.all(
        Array.from({ length: count }, () => createCustomer(prisma, { member: { roomId } })),
      );
      const result = await sendNotification(shopkeeperId, toMembers(designId));
      const tokens = stub.messages().map((m) => m.data?.rt as string);
      return { sendId: result.id, tokens, customers, shopkeeperId, roomId };
    }

    const counters = async (sendId: string) => {
      const s = await prisma.notificationSend.findUniqueOrThrow({ where: { id: sendId } });
      return [s.deliveredCount, s.openedCount, s.clickedCount];
    };

    it("counts delivered, opened and clicked once per device, in order", async () => {
      const { sendId, tokens } = await sentTo(2);
      await recordReceipt(tokens[0], "DELIVERED");
      assert.deepEqual(await counters(sendId), [1, 0, 0]);

      await recordReceipt(tokens[0], "CLICKED"); // implies opened
      assert.deepEqual(await counters(sendId), [1, 1, 1]);

      await recordReceipt(tokens[1], "OPENED"); // implies delivered
      assert.deepEqual(await counters(sendId), [2, 2, 1]);
    });

    it("ignores repeats and concurrent duplicates", async () => {
      const { sendId, tokens } = await sentTo();
      await Promise.all(
        Array.from({ length: 8 }, () => recordReceipt(tokens[0], "CLICKED")),
      );
      await recordReceipt(tokens[0], "DELIVERED");
      assert.deepEqual(await counters(sendId), [1, 1, 1]);
    });

    it("ignores unknown tokens without error", async () => {
      const { sendId } = await sentTo();
      await assert.doesNotReject(() =>
        recordReceipt("00000000-0000-4000-8000-000000000000", "CLICKED"),
      );
      assert.deepEqual(await counters(sendId), [0, 0, 0]);
    });
  });

  describe("getSendDesign access", () => {
    it("serves a member, a nearby non-member recipient, and nobody else", async () => {
      const { shopkeeperId, roomId } = await createShop(prisma);
      const designId = await createDesign(prisma, shopkeeperId);
      const member = await createCustomer(prisma, { member: { roomId } });
      const result = await sendNotification(shopkeeperId, toMembers(designId));

      const stranger = await createCustomer(prisma);
      const nearbyOutsider = await createCustomer(prisma);
      await prisma.notificationSendRecipient.create({
        data: {
          sendId: result.id,
          customerId: nearbyOutsider.customerId,
          receiptToken: "11111111-1111-4111-8111-111111111111",
        },
      });

      assert.ok(await getSendDesign(member.customerId, result.id));
      assert.ok(await getSendDesign(nearbyOutsider.customerId, result.id));
      await assert.rejects(
        () => getSendDesign(stranger.customerId, result.id),
        (err: unknown) => err instanceof NotificationError && err.status === 404,
      );
    });
  });
});
