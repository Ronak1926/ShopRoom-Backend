/**
 * services/customerDevice.service.ts — FCM device-token registration for
 * push notifications. One row per browser/device; re-registering an existing
 * token reassigns it to whoever is currently logged in on that device.
 */

import { prisma } from "../database/prisma.js";

interface RegisterDeviceInput {
  fcmToken: string;
  platform: "WEB" | "ANDROID" | "IOS";
  userAgent?: string;
}

export async function registerDevice(customerId: string, input: RegisterDeviceInput) {
  const device = await prisma.customerDevice.upsert({
    where: { fcmToken: input.fcmToken },
    update: {
      customerId,
      platform: input.platform,
      userAgent: input.userAgent,
      lastSeenAt: new Date(),
    },
    create: {
      customerId,
      fcmToken: input.fcmToken,
      platform: input.platform,
      userAgent: input.userAgent,
    },
    select: { id: true, platform: true },
  });
  return device;
}

/** Scoped to customerId so a customer can't unregister another account's device. */
export async function unregisterDevice(customerId: string, fcmToken: string): Promise<void> {
  await prisma.customerDevice.deleteMany({ where: { fcmToken, customerId } });
}
