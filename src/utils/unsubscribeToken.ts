/**
 * utils/unsubscribeToken.ts — The signed value in a newsletter "unsubscribe" link.
 *
 * It is the address plus an HMAC of it, so a link can only be made by us, nothing needs to be
 * stored to check it, and one person's link cannot be turned into another person's. It carries
 * no expiry on purpose: an old email must still let someone leave the list.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PURPOSE = "newsletter-unsubscribe-v1";

function sign(email: string): Buffer {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not defined");
  return createHmac("sha256", secret).update(`${PURPOSE}\0${email}`).digest();
}

export function createUnsubscribeToken(email: string): string {
  return `${Buffer.from(email, "utf8").toString("base64url")}.${sign(email).toString("base64url")}`;
}

/** Returns the address the token was made for, or null if it is malformed or was not signed by us. */
export function readUnsubscribeToken(token: string): string | null {
  const [encoded, signature, ...rest] = token.split(".");
  if (!encoded || !signature || rest.length > 0) return null;
  const email = Buffer.from(encoded, "base64url").toString("utf8");
  const expected = sign(email);
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return email;
}
