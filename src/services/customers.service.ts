import { Prisma } from "../generated/client.js";
import { prisma } from "../database/prisma.js";
import { hashPassword, needsRehash, verifyPassword } from "../utils/password.js";
import { forgetSession } from "./session.service.js";

export type CustomerSafe = {
  id: string;
  fullName: string;
  email: string;
  allowLocationAccess: boolean;
  latitude: number | null;
  longitude: number | null;
  createdAt: Date;
  updatedAt: Date;
};

function toSafeCustomer(c: {
  id: string;
  fullName: string;
  email: string;
  allowLocationAccess: boolean;
  latitude: number | null;
  longitude: number | null;
  createdAt: Date;
  updatedAt: Date;
}): CustomerSafe {
  return {
    id: c.id,
    fullName: c.fullName,
    email: c.email,
    allowLocationAccess: c.allowLocationAccess,
    latitude: c.latitude,
    longitude: c.longitude,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

export async function registerCustomer(input: {
  fullName: string;
  email: string;
  password: string;
  allowLocationAccess: boolean;
  latitude?: number;
  longitude?: number;
}) {
  const existing = await prisma.customer.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (existing) {
    return { ok: false as const, reason: "EMAIL_EXISTS" as const };
  }

  const passwordHash = await hashPassword(input.password);

  let customer;
  try {
    customer = await prisma.customer.create({
      data: {
        fullName: input.fullName,
        email: input.email,
        passwordHash,
        allowLocationAccess: input.allowLocationAccess,
        latitude: typeof input.latitude === "number" ? input.latitude : null,
        longitude: typeof input.longitude === "number" ? input.longitude : null,
        locationUpdatedAt:
          input.allowLocationAccess &&
          typeof input.latitude === "number" &&
          typeof input.longitude === "number"
            ? new Date()
            : null,
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        allowLocationAccess: true,
        latitude: true,
        longitude: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  } catch (err) {
    // Two sign-ups racing for one email: the unique index picks the loser.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false as const, reason: "EMAIL_EXISTS" as const };
    }
    throw err;
  }

  // A new account has never had a session revoked.
  return { ok: true as const, customer: toSafeCustomer(customer), tokenVersion: 0 };
}

export async function updateCustomer(
  id: string,
  input: { fullName?: string; allowLocationAccess?: boolean },
): Promise<CustomerSafe> {
  const customer = await prisma.customer.update({
    where: { id },
    data: {
      ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
      ...(input.allowLocationAccess !== undefined
        ? { allowLocationAccess: input.allowLocationAccess }
        : {}),
      // Withdrawing consent also erases the stored position.
      ...(input.allowLocationAccess === false
        ? { latitude: null, longitude: null, locationUpdatedAt: null }
        : {}),
    },
    select: {
      id: true,
      fullName: true,
      email: true,
      allowLocationAccess: true,
      latitude: true,
      longitude: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return toSafeCustomer(customer);
}

/**
 * Stores the customer's current position for radius-based notifications.
 * Returns false when they haven't consented to location access, so a client
 * can't push coordinates for an account that opted out.
 */
export async function reportCustomerLocation(
  id: string,
  position: { latitude: number; longitude: number },
): Promise<boolean> {
  const result = await prisma.customer.updateMany({
    where: { id, allowLocationAccess: true },
    data: { ...position, locationUpdatedAt: new Date() },
  });
  return result.count === 1;
}

export async function getCustomerById(id: string) {
  const cusomer = await prisma.customer.findUnique({
    where: { id },
    select: {
      id: true,
      fullName: true,
      email: true,
      allowLocationAccess: true,
      latitude: true,
      longitude: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return cusomer ? toSafeCustomer(cusomer) : null;
}

export type JoinedRoom = {
  roomId: string;
  shopName: string;
  category: string;
  logoUrl: string | null;
  membersCount: number;
  joinedAt: string;
};

/** Rooms the given customer has joined, most recently joined first. */
export async function getJoinedRooms(customerId: string): Promise<JoinedRoom[]> {
  const memberships = await prisma.membership.findMany({
    where: { customerId },
    orderBy: { joinedAt: "desc" },
    select: {
      joinedAt: true,
      room: {
        select: {
          id: true,
          membersCount: true,
          shop: { select: { shopName: true, category: true, logoUrl: true } },
        },
      },
    },
  });

  return memberships.map((m) => ({
    roomId: m.room.id,
    shopName: m.room.shop.shopName,
    category: m.room.shop.category,
    logoUrl: m.room.shop.logoUrl,
    membersCount: m.room.membersCount,
    joinedAt: m.joinedAt.toISOString(),
  }));
}

export async function googleAuthCustomer(input: {
  firebaseUid: string;
  email: string;
  fullName: string;
}) {
  const byUid = await prisma.customer.findUnique({
    where: { firebaseUid: input.firebaseUid },
  });
  if (byUid) {
    return { customer: toSafeCustomer(byUid), tokenVersion: byUid.tokenVersion };
  }

  const byEmail = await prisma.customer.findUnique({
    where: { email: input.email },
  });
  if (!byEmail) {
    // Brand-new customer — create without a password
    const created = await prisma.customer.create({
      data: {
        fullName: input.fullName,
        email: input.email,
        firebaseUid: input.firebaseUid,
        passwordHash: null,
        emailVerified: true,
        allowLocationAccess: false,
      },
    });
    return { customer: toSafeCustomer(created), tokenVersion: created.tokenVersion };
  }

  // Link the Google identity to the existing email account. If nobody ever
  // proved they own that email, whoever registered it with a password may be
  // squatting on it: the Google-verified owner takes over, the password is
  // removed and any session the squatter holds is revoked.
  const unverifiedSquatter = !byEmail.emailVerified && byEmail.passwordHash !== null;
  const linked = await prisma.customer.update({
    where: { id: byEmail.id },
    data: {
      firebaseUid: input.firebaseUid,
      emailVerified: true,
      ...(unverifiedSquatter ? { passwordHash: null, tokenVersion: { increment: 1 } } : {}),
    },
  });
  if (unverifiedSquatter) forgetSession("customer", linked.id);
  return { customer: toSafeCustomer(linked), tokenVersion: linked.tokenVersion };
}

export async function loginCustomer(input: {
  email: string;
  password: string;
}) {
  const customer = await prisma.customer.findUnique({
    where: { email: input.email },
  });

  // Always runs a bcrypt comparison, so unknown emails cost the same time as wrong passwords.
  const ok = await verifyPassword(input.password, customer?.passwordHash);
  if (!customer || !ok) {
    return { ok: false as const, reason: "INVALID_CREDENTIALS" as const };
  }

  if (customer.passwordHash && needsRehash(customer.passwordHash)) {
    // Best effort: failing to upgrade the hash must not fail the login.
    await hashPassword(input.password)
      .then((passwordHash) =>
        prisma.customer.update({ where: { id: customer.id }, data: { passwordHash } }),
      )
      .catch(() => undefined);
  }

  return {
    ok: true as const,
    customer: toSafeCustomer(customer),
    tokenVersion: customer.tokenVersion,
  };
}

/** Everything the account deletion flow needs to check before erasing a customer. */
export async function getCustomerAuthFactors(id: string) {
  return prisma.customer.findUnique({
    where: { id },
    select: { passwordHash: true, firebaseUid: true },
  });
}

/**
 * Permanently erases a customer: profile, location, memberships, devices,
 * messages, reactions and delivery records all go with the row (cascade).
 * Returns the rooms they belonged to so live connections can be evicted.
 */
export async function deleteCustomerAccount(customerId: string): Promise<string[]> {
  const roomIds = await prisma.$transaction(async (tx) => {
    const memberships = await tx.membership.findMany({
      where: { customerId },
      select: { roomId: true },
    });
    const ids = memberships.map((m) => m.roomId);
    if (ids.length > 0) {
      await tx.room.updateMany({
        where: { id: { in: ids } },
        data: { membersCount: { decrement: 1 } },
      });
    }
    await tx.customer.delete({ where: { id: customerId } });
    return ids;
  });
  forgetSession("customer", customerId);
  return roomIds;
}
