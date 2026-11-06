/**
 * utils/jwt.ts — All JWT helpers for ShopRoom.
 *
 * TOKEN TYPES
 * ────────────
 * customerToken        — 7-day session token for customers.
 * phoneVerifiedToken   — 15-min short-lived token proving phone OTP passed for a draft.
 * shopkeeperToken      — 7-day session token for shopkeepers.
 * mfaPendingToken      — 5-min token proving the password step passed, redeemable only for the second step.
 *
 * HARDENING
 * ──────────
 * - Algorithm is pinned to HS256 on verify, so a forged "alg" header can't pick
 *   a weaker or "none" scheme.
 * - Every token carries an issuer and a per-type audience; a token minted for
 *   one purpose is rejected for any other.
 * - Session tokens carry the account's `tv` (tokenVersion). Bumping it in the
 *   database revokes every earlier token (see services/session.service.ts).
 * - Secret rotation without logging everyone out: set JWT_SECRET to the new
 *   value and JWT_SECRET_PREVIOUS to the old one; tokens signed with either
 *   verify, new tokens are always signed with the new one. Remove
 *   JWT_SECRET_PREVIOUS once the old tokens have expired (7 days).
 */

import jwt from "jsonwebtoken";

const ALGORITHM = "HS256";
const ISSUER = "shoproom";

type Audience = "customer" | "shopkeeper" | "phone_verified" | "mfa_pending";

function signingSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not defined");
  return secret;
}

function verificationSecrets(): string[] {
  const previous = process.env.JWT_SECRET_PREVIOUS;
  return previous ? [signingSecret(), previous] : [signingSecret()];
}

function sign(payload: object, audience: Audience, expiresIn: jwt.SignOptions["expiresIn"]): string {
  return jwt.sign(payload, signingSecret(), {
    algorithm: ALGORITHM,
    issuer: ISSUER,
    audience,
    expiresIn,
  });
}

function verify(token: string, audience: Audience): unknown {
  let firstError: unknown;
  for (const secret of verificationSecrets()) {
    try {
      return jwt.verify(token, secret, { algorithms: [ALGORITHM], issuer: ISSUER, audience });
    } catch (err) {
      firstError ??= err;
    }
  }
  throw firstError;
}

// ── Customer ──────────────────────────────────────────────────────────────────

export type CustomerJwtPayload = {
  sub: string;
  type: "customer";
  tv: number;
};

export function signCustomerToken(customerId: string, tokenVersion: number): string {
  const payload: CustomerJwtPayload = { sub: customerId, type: "customer", tv: tokenVersion };
  return sign(payload, "customer", "7d");
}

export function verifyCustomerToken(token: string): CustomerJwtPayload {
  const payload = verify(token, "customer") as Partial<CustomerJwtPayload> | string;
  if (
    typeof payload !== "object" ||
    payload === null ||
    payload.type !== "customer" ||
    typeof payload.sub !== "string" ||
    typeof payload.tv !== "number"
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

export function signPhoneVerifiedToken(draftId: string, phoneNumber: string): string {
  const payload: PhoneVerifiedPayload = { type: "phone_verified", draftId, phoneNumber };
  return sign(payload, "phone_verified", "15m");
}

export function verifyPhoneVerifiedToken(token: string): PhoneVerifiedPayload {
  const payload = verify(token, "phone_verified") as Partial<PhoneVerifiedPayload> | string;
  if (typeof payload !== "object" || payload === null || payload.type !== "phone_verified") {
    throw new Error("Invalid phone verification token");
  }
  return payload as PhoneVerifiedPayload;
}

// ── Two-step verification: between the password and the code ──────────────────

export interface MfaPendingPayload {
  sub: string;
  type: "mfa_pending";
  role: "CUSTOMER" | "SHOPKEEPER";
  /** The account's tokenVersion when the password was accepted; a password change in between voids this token. */
  tv: number;
}

export function signMfaPendingToken(role: MfaPendingPayload["role"], accountId: string, tokenVersion: number): string {
  const payload: MfaPendingPayload = { sub: accountId, type: "mfa_pending", role, tv: tokenVersion };
  return sign(payload, "mfa_pending", "5m");
}

export function verifyMfaPendingToken(token: string): MfaPendingPayload {
  const payload = verify(token, "mfa_pending") as Partial<MfaPendingPayload> | string;
  if (
    typeof payload !== "object" ||
    payload === null ||
    payload.type !== "mfa_pending" ||
    typeof payload.sub !== "string" ||
    typeof payload.tv !== "number" ||
    (payload.role !== "CUSTOMER" && payload.role !== "SHOPKEEPER")
  ) {
    throw new Error("Invalid two-step token");
  }
  return payload as MfaPendingPayload;
}

// ── Shopkeeper ────────────────────────────────────────────────────────────────

export interface ShopkeeperJwtPayload {
  sub: string;
  type: "shopkeeper";
  tv: number;
}

export function signShopkeeperToken(shopkeeperId: string, tokenVersion: number): string {
  const payload: ShopkeeperJwtPayload = { sub: shopkeeperId, type: "shopkeeper", tv: tokenVersion };
  return sign(payload, "shopkeeper", "7d");
}

export function verifyShopkeeperToken(token: string): ShopkeeperJwtPayload {
  const payload = verify(token, "shopkeeper") as Partial<ShopkeeperJwtPayload> | string;
  if (
    typeof payload !== "object" ||
    payload === null ||
    payload.type !== "shopkeeper" ||
    typeof payload.sub !== "string" ||
    typeof payload.tv !== "number"
  ) {
    throw new Error("Invalid shopkeeper token");
  }
  return payload as ShopkeeperJwtPayload;
}
