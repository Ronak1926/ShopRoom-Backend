/**
 * test/integration.ts — Shared setup for tests that need a real Postgres.
 *
 * They run against the database named by TEST_DATABASE_URL (read from
 * .env.test) and are skipped when it is not set. The name must contain "test"
 * so a mistyped URL can never wipe a real database.
 *
 * Firebase is never contacted: the Admin SDK is initialised with a throwaway
 * key and `sendEach` is replaced with a stub.
 */

import { existsSync } from "node:fs";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import type { BatchResponse, Message } from "firebase-admin/messaging";

export function integrationConfigured(): boolean {
  if (!process.env.TEST_DATABASE_URL && existsSync(".env.test")) {
    process.loadEnvFile(".env.test");
  }
  return Boolean(process.env.TEST_DATABASE_URL);
}

export async function connectTestEnvironment() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !/test/i.test(new URL(url).pathname)) {
    throw new Error("TEST_DATABASE_URL must point at a database whose name contains 'test'");
  }
  process.env.DATABASE_URL = url;
  process.env.JWT_SECRET = "integration-test-secret";

  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  process.env.FIREBASE_PROJECT_ID = "shoproom-test";
  process.env.FIREBASE_CLIENT_EMAIL = "test@shoproom-test.iam.gserviceaccount.com";
  process.env.FIREBASE_PRIVATE_KEY = privateKey;

  const { prisma } = await import("../database/prisma.js");
  const { firebaseMessaging } = await import("../lib/firebaseAdmin.js");
  return { prisma, firebaseMessaging };
}

type TestEnvironment = Awaited<ReturnType<typeof connectTestEnvironment>>;
export type TestPrisma = TestEnvironment["prisma"];
export type TestMessaging = TestEnvironment["firebaseMessaging"];

/** Empties every table the notification feature touches. */
export async function resetDatabase(prisma: TestPrisma): Promise<void> {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "Shopkeeper", "Customer" CASCADE`);
}

export interface FakeOutcome {
  success: boolean;
  code?: string;
}

/** Replaces sendEach; returns every message batch it was asked to send. */
export function stubSendEach(
  messaging: TestMessaging,
  decide: (message: Message) => FakeOutcome = () => ({ success: true }),
) {
  const original = messaging.sendEach.bind(messaging);
  const batches: Message[][] = [];
  (messaging as { sendEach: unknown }).sendEach = async (messages: Message[]) => {
    batches.push(messages);
    const outcomes = messages.map(decide);
    const response: BatchResponse = {
      successCount: outcomes.filter((o) => o.success).length,
      failureCount: outcomes.filter((o) => !o.success).length,
      responses: outcomes.map((o) =>
        o.success
          ? { success: true, messageId: randomUUID() }
          : { success: false, error: { code: o.code ?? "messaging/internal-error" } as never },
      ),
    };
    return response;
  };
  return {
    batches,
    messages: () => batches.flat(),
    restore: () => {
      (messaging as { sendEach: unknown }).sendEach = original;
    },
  };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

export const MUMBAI = { latitude: 19.076, longitude: 72.8777 };

let counter = 0;
const unique = () => `${Date.now().toString(36)}${(counter += 1)}${randomUUID().slice(0, 6)}`;

export async function createShop(
  prisma: TestPrisma,
  options: { planType?: string; location?: { latitude: number; longitude: number } | null } = {},
) {
  const tag = unique();
  const location = options.location === undefined ? MUMBAI : options.location;
  const shopkeeper = await prisma.shopkeeper.create({
    data: {
      email: `shop-${tag}@example.test`,
      passwordHash: "x",
      shopName: `Shop ${tag}`,
      shopCategory: "Fashion",
      address: "1 Test Road",
      city: "Mumbai",
      state: "MH",
      pincode: "400001",
      phoneNumber: "+910000000000",
      planType: options.planType ?? "3m",
      planExpiresAt: new Date(Date.now() + 30 * 86_400_000),
    },
    select: { id: true, shopName: true },
  });
  const shop = await prisma.shop.create({
    data: {
      ownerId: shopkeeper.id,
      shopName: shopkeeper.shopName,
      category: "Fashion",
      address: "1 Test Road",
      city: "Mumbai",
      state: "MH",
      pincode: "400001",
      phoneNumber: "+910000000000",
      latitude: location?.latitude ?? null,
      longitude: location?.longitude ?? null,
    },
    select: { id: true },
  });
  const room = await prisma.room.create({
    data: { shopId: shop.id, inviteCode: `INV${tag}`.slice(0, 12) },
    select: { id: true },
  });
  return { shopkeeperId: shopkeeper.id, shopId: shop.id, roomId: room.id };
}

export function sampleDesign(options: { imageUrl?: string } = {}) {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: "design-test",
    name: "Test banner",
    category: "OFFER",
    status: "DRAFT",
    canvas: { width: 400, height: 200, background: { type: "SOLID", color: "#ffffff" } },
    elements: [
      {
        id: "headline",
        type: "TEXT",
        frame: { x: 10, y: 10, width: 200, height: 40 },
        content: { text: "Big sale" },
        visible: true,
        locked: false,
      },
      ...(options.imageUrl
        ? [
            {
              id: "hero",
              type: "IMAGE",
              frame: { x: 220, y: 10, width: 160, height: 160 },
              asset: { type: "IMAGE", url: options.imageUrl },
              visible: true,
              locked: false,
            },
          ]
        : []),
    ],
    metadata: { createdAt: now, updatedAt: now, source: "CUSTOM" },
  };
}

export async function createDesign(
  prisma: TestPrisma,
  shopkeeperId: string,
  options: { imageUrl?: string } = {},
) {
  const design = await prisma.notificationDesign.create({
    data: { shopkeeperId, name: "Test banner", designJson: sampleDesign(options) },
    select: { id: true },
  });
  return design.id;
}

export interface CustomerOptions {
  /** Last reported position; omitted means none on file. */
  location?: { latitude: number; longitude: number };
  allowLocation?: boolean;
  /** How long ago the position was reported. Defaults to just now. */
  locationAgeHours?: number;
  member?: { roomId: string; notificationsEnabled?: boolean; joinedAt?: Date };
  devices?: number;
}

export async function createCustomer(prisma: TestPrisma, options: CustomerOptions = {}) {
  const tag = unique();
  const allow = options.allowLocation ?? Boolean(options.location);
  const customer = await prisma.customer.create({
    data: {
      fullName: `Customer ${tag}`,
      email: `cust-${tag}@example.test`,
      passwordHash: "x",
      allowLocationAccess: allow,
      latitude: options.location?.latitude ?? null,
      longitude: options.location?.longitude ?? null,
      locationUpdatedAt: options.location
        ? new Date(Date.now() - (options.locationAgeHours ?? 0) * 3_600_000)
        : null,
    },
    select: { id: true },
  });

  if (options.member) {
    await prisma.membership.create({
      data: {
        roomId: options.member.roomId,
        customerId: customer.id,
        notificationsEnabled: options.member.notificationsEnabled ?? true,
        ...(options.member.joinedAt ? { joinedAt: options.member.joinedAt } : {}),
      },
    });
  }

  const deviceCount = options.devices ?? 1;
  const devices = await Promise.all(
    Array.from({ length: deviceCount }, () =>
      prisma.customerDevice.create({
        data: { customerId: customer.id, fcmToken: `token-${unique()}-${randomUUID()}` },
        select: { id: true, fcmToken: true },
      }),
    ),
  );
  return {
    customerId: customer.id,
    deviceIds: devices.map((d) => d.id),
    tokens: devices.map((d) => d.fcmToken),
  };
}
