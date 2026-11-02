// Load test for the notification fan-out: audience query, recipient rows,
// batching into FCM calls, outcome persistence and dead-token cleanup.
//
// FCM itself is replaced by a stub that answers instantly, so the numbers are
// OUR overhead (database + CPU + memory) at a given audience size, not Google's
// delivery time. Needs the database from seedPerf.sql:
//
//   TEST_DATABASE_URL=postgresql://…/shoproom_perf_test \
//     pnpm exec tsx scripts/loadtest/send.ts 50000 0.2
//
//   arg 1: audience size (default 50000)    arg 2: share of dead tokens (default 0.1)
import { connectTestEnvironment, createDesign, stubSendEach } from "../../src/test/integration.js";

const size = Number(process.argv[2] ?? 50_000);
const deadShare = Number(process.argv[3] ?? 0.1);

const { prisma, firebaseMessaging } = await connectTestEnvironment();
const { sendNotification } = await import("../../src/services/notificationSend.service.js");

// A dedicated shop whose room holds `size` members, each with one device.
const tag = Date.now().toString(36);
const owner = await prisma.shopkeeper.create({
  data: {
    email: `load-${tag}@perf.test`, passwordHash: "x", shopName: "Load test shop", shopCategory: "Fashion", address: "1 Road",
    city: "Mumbai", state: "MH", pincode: "400001", phoneNumber: "+910000000000", planType: "3m",
    planExpiresAt: new Date(Date.now() + 30 * 86_400_000),
  },
  select: { id: true },
});
const shop = await prisma.shop.create({
  data: {
    ownerId: owner.id, shopName: "Load test shop", category: "Fashion", address: "1 Road", city: "Mumbai", state: "MH",
    pincode: "400001", phoneNumber: "+910000000000", latitude: 19.07, longitude: 72.87,
  },
  select: { id: true },
});
const room = await prisma.room.create({ data: { shopId: shop.id, inviteCode: `LOAD${tag}`.slice(0, 12) }, select: { id: true } });
const designId = await createDesign(prisma, owner.id);
await prisma.$executeRaw`
  INSERT INTO "Membership" ("id","roomId","customerId")
  SELECT 'lm' || ${tag} || c."id", ${room.id}, c."id" FROM "Customer" c ORDER BY c."id" LIMIT ${size}`;

const dead = new Set(
  (await prisma.$queryRaw<{ fcmToken: string }[]>`
    SELECT d."fcmToken" FROM "CustomerDevice" d JOIN "Membership" m ON m."customerId" = d."customerId"
    WHERE m."roomId" = ${room.id} ORDER BY d."id" LIMIT ${Math.floor(size * deadShare)}`).map((r) => r.fcmToken),
);
const stub = stubSendEach(firebaseMessaging, (message) => {
  const token = (message as { token: string }).token;
  return dead.has(token) ? { success: false, code: "messaging/registration-token-not-registered" } : { success: true };
});

const before = process.memoryUsage();
const started = performance.now();
const result = await sendNotification(owner.id, {
  source: "DESIGN",
  notificationId: designId,
  audience: { mode: "ROOM_MEMBERS", radiusKm: 10 },
  message: "Load test",
});
const seconds = (performance.now() - started) / 1000;
const after = process.memoryUsage();
const send = await prisma.notificationSend.findUniqueOrThrow({ where: { id: result.id } });
const remaining = await prisma.customerDevice.count({ where: { customer: { memberships: { some: { roomId: room.id } } } } });

const mb = (bytes: number) => Math.round(bytes / 1_048_576);
console.table({
  audience: size,
  recipients: result.recipients,
  fcmBatches: stub.batches.length,
  largestBatch: Math.max(...stub.batches.map((b) => b.length)),
  seconds: Number(seconds.toFixed(2)),
  devicesPerSecond: Math.round(result.recipients / seconds),
  status: send.status,
  succeeded: send.successCount,
  failed: send.failureCount,
  deadTokensRemoved: size - remaining,
  heapGrowthMB: mb(after.heapUsed - before.heapUsed),
  rssMB: mb(after.rss),
});

// Leave the scratch database as it was found.
await prisma.notificationSend.deleteMany({ where: { shopkeeperId: owner.id } });
await prisma.shopkeeper.delete({ where: { id: owner.id } });
stub.restore();
await prisma.$disconnect();
