/**
 * utils/jwt.ts — All JWT helpers for ShopRoom.
 *
 * TOKEN TYPES
 * ────────────
 * customerToken        — 7-day session token for customers.
 * phoneVerifiedToken   — 15-min short-lived token proving phone OTP passed for a draft.
 * shopkeeperToken      — 7-day session token for shopkeepers.
 */

import jwt from "jsonwebtoken";

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not defined");
  return secret;
}

// ── Customer ──────────────────────────────────────────────────────────────────

export type CustomerJwtPayload = {
  sub: string;
  type: "customer";
};

export function signCustomerToken(customerId: string): string {
  const payload: CustomerJwtPayload = { sub: customerId, type: "customer" };
  return jwt.sign(payload, getSecret(), { expiresIn: "7d" });
}

export function verifyCustomerToken(token: string): CustomerJwtPayload {
  const payload = jwt.verify(token, getSecret());
  if (
    typeof payload !== "object" ||
    payload === null ||
    (payload as CustomerJwtPayload).type !== "customer" ||
    typeof (payload as CustomerJwtPayload).sub !== "string"
  ) {
    throw new Error("Invalid customer token");
  }
  return payload as CustomerJwtPayload;
}

// ── Phone Verified (shopkeeper draft) ────────────────────────────────────────

export interface PhoneVerifiedPayload {
  type: "phone_verified";
  draftId: string;
  phoneNumber: string;
}

export function signPhoneVerifiedToken(
  draftId: string,
  phoneNumber: string,
): string {
  const payload: PhoneVerifiedPayload = {
    type: "phone_verified",
    draftId,
    phoneNumber,
  };
  return jwt.sign(payload, getSecret(), { expiresIn: "15m" });
}

export function verifyPhoneVerifiedToken(token: string): PhoneVerifiedPayload {
  const payload = jwt.verify(token, getSecret());
  if (
    typeof payload !== "object" ||
    payload === null ||
    (payload as PhoneVerifiedPayload).type !== "phone_verified"
  ) {
    throw new Error("Invalid phone verification token");
  }
  return payload as PhoneVerifiedPayload;
}

// ── Shopkeeper ────────────────────────────────────────────────────────────────

export interface ShopkeeperJwtPayload {
  sub: string;
  type: "shopkeeper";
}

export function signShopkeeperToken(shopkeeperId: string): string {
  const payload: ShopkeeperJwtPayload = {
    sub: shopkeeperId,
    type: "shopkeeper",
  };
  return jwt.sign(payload, getSecret(), { expiresIn: "7d" });
}

export function verifyShopkeeperToken(token: string): ShopkeeperJwtPayload {
  const payload = jwt.verify(token, getSecret());
  if (
    typeof payload !== "object" ||
    payload === null ||
    (payload as ShopkeeperJwtPayload).type !== "shopkeeper"
  ) {
    throw new Error("Invalid shopkeeper token");
  }
  return payload as ShopkeeperJwtPayload;
}
