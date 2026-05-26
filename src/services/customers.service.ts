import bcrypt from "bcrypt";
import { prisma } from "../database/prisma.js";

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
  });
  if (existing) {
    return { ok: false as const, reason: "EMAIL_EXISTS" as const };
  }

  const passwordHash = await bcrypt.hash(input.password, 10);

  const customer = await prisma.customer.create({
    data: {
      fullName: input.fullName,
      email: input.email,
      passwordHash,
      allowLocationAccess: input.allowLocationAccess,
      latitude: typeof input.latitude === "number" ? input.latitude : null,
      longitude: typeof input.longitude === "number" ? input.longitude : null,
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

  return { ok: true as const, customer: toSafeCustomer(customer) };
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

export async function googleAuthCustomer(input: {
  firebaseUid: string;
  email: string;
  fullName: string;
}) {
  // Try to find by firebaseUid first, then fall back to email
  let customer = await prisma.customer.findUnique({
    where: { firebaseUid: input.firebaseUid },
  });

  if (!customer) {
    customer = await prisma.customer.findUnique({
      where: { email: input.email },
    });

    if (customer) {
      // Existing email-based account — link it to the Google uid
      customer = await prisma.customer.update({
        where: { id: customer.id },
        data: { firebaseUid: input.firebaseUid },
      });
    } else {
      // Brand-new customer — create without a password
      customer = await prisma.customer.create({
        data: {
          fullName: input.fullName,
          email: input.email,
          firebaseUid: input.firebaseUid,
          passwordHash: null,
          allowLocationAccess: false,
        },
      });
    }
  }

  return { ok: true as const, customer: toSafeCustomer(customer) };
}

export async function loginCustomer(input: {
  email: string;
  password: string;
}) {
  const customer = await prisma.customer.findUnique({
    where: { email: input.email },
  });

  if (!customer || !customer.passwordHash) {
    return { ok: false as const, reason: "INVALID_CREDENTIALS" as const };
  }

  const ok = await bcrypt.compare(input.password, customer.passwordHash);
  if (!ok) {
    return { ok: false as const, reason: "INVALID_CREDENTIALS" as const };
  }

  return {
    ok: true as const,
    customer: toSafeCustomer({
      id: customer.id,
      fullName: customer.fullName,
      email: customer.email,
      allowLocationAccess: customer.allowLocationAccess,
      latitude: customer.latitude,
      longitude: customer.longitude,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
    }),
  };
}
