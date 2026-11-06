/**
 * services/dataExport.service.ts — "Download my data": everything ShopRoom holds about one account,
 * as plain JSON the person can read or take elsewhere.
 *
 * What is left out, deliberately:
 *  - credentials: password hashes, session counters, Firebase ids and push tokens (a copy of the
 *    file must not be a way into the account);
 *  - other people's personal data: a shopkeeper's export gives the number of members, not their
 *    names and emails (the shopkeeper already sees those in the dashboard, but a file that can be
 *    forwarded is a different thing).
 *
 * Every list is capped so one account cannot make the server build an unbounded response; when a
 * list is cut, `truncated` says which one, so the file never silently looks complete when it is not.
 */

import { prisma } from "../database/prisma.js";
import { decryptText } from "../utils/crypto.js";

const MESSAGE_LIMIT = 20_000;
const LIST_LIMIT = 5_000;

type Truncated = Record<string, boolean>;

/** Fetches up to `limit` rows (asks for one more to learn whether there were more). */
function capped<T>(rows: T[], limit: number): { rows: T[]; cut: boolean } {
  return rows.length > limit ? { rows: rows.slice(0, limit), cut: true } : { rows, cut: false };
}

const shopNameOfRoom = { select: { shop: { select: { shopName: true } } } } as const;

export async function exportCustomerData(customerId: string) {
  const [customer, memberships, messages, reactions, viewerStates, devices, deliveries] = await Promise.all([
    prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        fullName: true,
        email: true,
        emailVerified: true,
        passwordHash: true,
        firebaseUid: true,
        allowLocationAccess: true,
        latitude: true,
        longitude: true,
        locationUpdatedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.membership.findMany({
      where: { customerId },
      select: { joinedAt: true, notificationsEnabled: true, room: shopNameOfRoom },
      orderBy: { joinedAt: "asc" },
      take: LIST_LIMIT + 1,
    }),
    prisma.message.findMany({
      where: { customerId },
      select: { text: true, createdAt: true, editedAt: true, deletedForEveryone: true, room: shopNameOfRoom },
      orderBy: { createdAt: "asc" },
      take: MESSAGE_LIMIT + 1,
    }),
    prisma.messageReaction.findMany({
      where: { customerId },
      select: { emoji: true, createdAt: true, message: { select: { room: shopNameOfRoom } } },
      orderBy: { createdAt: "asc" },
      take: LIST_LIMIT + 1,
    }),
    prisma.roomViewerState.findMany({
      where: { customerId },
      select: { lastReadAt: true, clearedAt: true, room: shopNameOfRoom },
      take: LIST_LIMIT + 1,
    }),
    prisma.customerDevice.findMany({
      where: { customerId },
      select: { platform: true, userAgent: true, createdAt: true, lastSeenAt: true },
      orderBy: { createdAt: "asc" },
      take: LIST_LIMIT + 1,
    }),
    prisma.notificationSendRecipient.findMany({
      where: { customerId },
      select: { status: true, createdAt: true, deliveredAt: true, openedAt: true, clickedAt: true, send: { select: { room: shopNameOfRoom } } },
      orderBy: { createdAt: "desc" },
      take: LIST_LIMIT + 1,
    }),
  ]);
  if (!customer) return null;

  const truncated: Truncated = {};
  const take = <T>(name: string, rows: T[], limit = LIST_LIMIT): T[] => {
    const { rows: kept, cut } = capped(rows, limit);
    truncated[name] = cut;
    return kept;
  };

  return {
    format: "shoproom-customer-export-v1",
    exportedAt: new Date().toISOString(),
    account: {
      id: customer.id,
      fullName: customer.fullName,
      email: customer.email,
      emailVerified: customer.emailVerified,
      signInMethods: [customer.passwordHash ? "password" : null, customer.firebaseUid ? "google" : null].filter(Boolean),
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
    },
    location: {
      sharingEnabled: customer.allowLocationAccess,
      latitude: customer.latitude,
      longitude: customer.longitude,
      updatedAt: customer.locationUpdatedAt,
    },
    rooms: take("rooms", memberships).map((m) => ({ shop: m.room.shop.shopName, joinedAt: m.joinedAt, notificationsEnabled: m.notificationsEnabled })),
    messages: take("messages", messages, MESSAGE_LIMIT).map((m) => ({
      shop: m.room.shop.shopName,
      text: m.deletedForEveryone ? "" : decryptText(m.text),
      sentAt: m.createdAt,
      editedAt: m.editedAt,
      deletedForEveryone: m.deletedForEveryone,
    })),
    reactions: take("reactions", reactions).map((r) => ({ shop: r.message.room.shop.shopName, emoji: r.emoji, reactedAt: r.createdAt })),
    chatReadState: take("chatReadState", viewerStates).map((v) => ({ shop: v.room.shop.shopName, lastReadAt: v.lastReadAt, clearedAt: v.clearedAt })),
    devices: take("devices", devices).map((d) => ({ platform: d.platform, browser: d.userAgent, registeredAt: d.createdAt, lastSeenAt: d.lastSeenAt })),
    notificationsReceived: take("notificationsReceived", deliveries).map((d) => ({
      shop: d.send.room.shop.shopName,
      status: d.status,
      receivedAt: d.createdAt,
      deliveredAt: d.deliveredAt,
      openedAt: d.openedAt,
      clickedAt: d.clickedAt,
    })),
    truncated,
    notIncluded: "Your password, sign-in tokens and push tokens are never included in this file.",
  };
}

export async function exportShopkeeperData(shopkeeperId: string) {
  const [shopkeeper, payments, designs, assets, schedules, sends, messages] = await Promise.all([
    prisma.shopkeeper.findUnique({
      where: { id: shopkeeperId },
      select: {
        id: true,
        email: true,
        ownerName: true,
        phoneNumber: true,
        gstin: true,
        planType: true,
        planExpiresAt: true,
        createdAt: true,
        shop: {
          select: {
            shopName: true,
            category: true,
            description: true,
            logoUrl: true,
            address: true,
            city: true,
            state: true,
            pincode: true,
            phoneNumber: true,
            latitude: true,
            longitude: true,
            createdAt: true,
            room: { select: { inviteCode: true, membersCount: true, coverUrl: true, createdAt: true } },
          },
        },
        notificationPreference: { select: { settings: true } },
      },
    }),
    prisma.planPayment.findMany({
      where: { shopkeeperId },
      select: { purpose: true, planType: true, amount: true, razorpayOrderId: true, razorpayPaymentId: true, createdAt: true, invoiceNumber: true, refundedAt: true },
      orderBy: { createdAt: "asc" },
      take: LIST_LIMIT + 1,
    }),
    prisma.notificationDesign.findMany({
      where: { shopkeeperId },
      select: { id: true, name: true, status: true, isArchived: true, designJson: true, createdAt: true, updatedAt: true },
      orderBy: { createdAt: "asc" },
      take: LIST_LIMIT + 1,
    }),
    prisma.notificationAsset.findMany({
      where: { shopkeeperId },
      select: { secureUrl: true, mimeType: true, sizeBytes: true, createdAt: true },
      orderBy: { createdAt: "asc" },
      take: LIST_LIMIT + 1,
    }),
    prisma.notificationSchedule.findMany({
      where: { shopkeeperId },
      select: { message: true, firstRunAt: true, recurrence: true, repeatEvery: true, timeZone: true, status: true, runCount: true, lastRunAt: true, nextRunAt: true, createdAt: true },
      orderBy: { createdAt: "asc" },
      take: LIST_LIMIT + 1,
    }),
    prisma.notificationSend.findMany({
      where: { shopkeeperId },
      select: {
        message: true,
        audience: true,
        status: true,
        recipientCount: true,
        successCount: true,
        failureCount: true,
        deliveredCount: true,
        openedCount: true,
        clickedCount: true,
        sentAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: LIST_LIMIT + 1,
    }),
    prisma.message.findMany({
      where: { shopkeeperId },
      select: { text: true, createdAt: true, editedAt: true, deletedForEveryone: true },
      orderBy: { createdAt: "asc" },
      take: MESSAGE_LIMIT + 1,
    }),
  ]);
  if (!shopkeeper) return null;

  const truncated: Truncated = {};
  const take = <T>(name: string, rows: T[], limit = LIST_LIMIT): T[] => {
    const { rows: kept, cut } = capped(rows, limit);
    truncated[name] = cut;
    return kept;
  };

  return {
    format: "shoproom-shopkeeper-export-v1",
    exportedAt: new Date().toISOString(),
    account: {
      id: shopkeeper.id,
      email: shopkeeper.email,
      ownerName: shopkeeper.ownerName,
      phoneNumber: shopkeeper.phoneNumber,
      gstin: shopkeeper.gstin,
      createdAt: shopkeeper.createdAt,
    },
    shop: shopkeeper.shop
      ? {
          name: shopkeeper.shop.shopName,
          category: shopkeeper.shop.category,
          description: shopkeeper.shop.description,
          logoUrl: shopkeeper.shop.logoUrl,
          address: shopkeeper.shop.address,
          city: shopkeeper.shop.city,
          state: shopkeeper.shop.state,
          pincode: shopkeeper.shop.pincode,
          phoneNumber: shopkeeper.shop.phoneNumber,
          latitude: shopkeeper.shop.latitude,
          longitude: shopkeeper.shop.longitude,
          createdAt: shopkeeper.shop.createdAt,
        }
      : null,
    room: shopkeeper.shop?.room ?? null,
    plan: { type: shopkeeper.planType, expiresAt: shopkeeper.planExpiresAt },
    payments: take("payments", payments).map((p) => ({
      purpose: p.purpose,
      plan: p.planType,
      amountPaise: p.amount,
      razorpayOrderId: p.razorpayOrderId,
      razorpayPaymentId: p.razorpayPaymentId,
      paidAt: p.createdAt,
      invoiceNumber: p.invoiceNumber,
      refundedAt: p.refundedAt,
    })),
    notificationPreferences: shopkeeper.notificationPreference?.settings ?? null,
    notificationDesigns: take("notificationDesigns", designs),
    uploadedImages: take("uploadedImages", assets),
    schedules: take("schedules", schedules),
    sends: take("sends", sends),
    chatMessages: take("chatMessages", messages, MESSAGE_LIMIT).map((m) => ({
      text: m.deletedForEveryone ? "" : decryptText(m.text),
      sentAt: m.createdAt,
      editedAt: m.editedAt,
      deletedForEveryone: m.deletedForEveryone,
    })),
    truncated,
    notIncluded:
      "Your password and sign-in tokens are never included. The names and emails of your room's members are not included either: they are your customers' personal data, and you can see them in your dashboard.",
  };
}
