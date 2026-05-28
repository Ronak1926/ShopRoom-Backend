/**
 * jwt.ts — shopkeeper JWT helpers
 *
 * Separate from src/utils/jwt.ts (customer tokens) so each token type
 * has its own payload shape and can be independently evolved.
 *
 * TOKEN TYPES
 * ────────────
 * phoneVerifiedToken
 *   • Short-lived (15 min) token issued immediately after successful phone OTP.
 *   • Proves "this browser session verified draftId X owns phoneNumber Y".
 *   • The frontend passes it as Authorization: Bearer <token> when calling
 *     /shopkeeper/payment/create-intent and /shopkeeper/register so that
 *     those endpoints can assert phone verification without a DB round-trip.
 *
 * shopkeeperToken
 *   • Long-lived (7 day) token issued after full registration completes.
 *   • type: "shopkeeper" distinguishes it from customer tokens.
 */

import jwt from "jsonwebtoken";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PhoneVerifiedPayload {
  type: "phone_verified";
  draftId: string;
  phoneNumber: string;
}

export interface ShopkeeperJwtPayload {
  sub: string;
  type: "shopkeeper";
}

// ─── Phone Verified Token ─────────────────────────────────────────────────────

/** Signs a short-lived token proving phone OTP was completed for a draft. */
export function signPhoneVerifiedToken(
  draftId: string,
  phoneNumber: string,
): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not defined");

  const payload: PhoneVerifiedPayload = {
    type: "phone_verified",
    draftId,
    phoneNumber,
  };

  return jwt.sign(payload, secret, { expiresIn: "15m" });
}

/** Verifies and decodes a phone-verified token. Throws on invalid/expired. */
export function verifyPhoneVerifiedToken(token: string): PhoneVerifiedPayload {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not defined");

  const payload = jwt.verify(token, secret);

  if (
    typeof payload !== "object" ||
    payload === null ||
    (payload as PhoneVerifiedPayload).type !== "phone_verified"
  ) {
    throw new Error("Invalid phone verification token");
  }

  return payload as PhoneVerifiedPayload;
}

// ─── Shopkeeper Token ─────────────────────────────────────────────────────────

/** Signs a long-lived token for an authenticated shopkeeper. */
export function signShopkeeperToken(shopkeeperId: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not defined");

  const payload: ShopkeeperJwtPayload = {
    sub: shopkeeperId,
    type: "shopkeeper",
  };
  return jwt.sign(payload, secret, { expiresIn: "7d" });
}

/** Verifies and decodes a shopkeeper session token. Throws on invalid/expired. */
export function verifyShopkeeperToken(token: string): ShopkeeperJwtPayload {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not defined");

  const payload = jwt.verify(token, secret);

  if (
    typeof payload !== "object" ||
    payload === null ||
    (payload as ShopkeeperJwtPayload).type !== "shopkeeper"
  ) {
    throw new Error("Invalid shopkeeper token");
  }

  return payload as ShopkeeperJwtPayload;
}
