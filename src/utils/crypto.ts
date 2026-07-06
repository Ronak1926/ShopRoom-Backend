/**
 * utils/crypto.ts — At-rest encryption for chat message text.
 *
 * AES-256-GCM with a key derived once (scrypt is deliberately slow — it must
 * never run per-message) from JWT_SECRET, so no separate secret needs to be
 * provisioned. Ciphertext is packed as iv(12) + authTag(16) + data, base64.
 */

import crypto from "node:crypto";

// Cast to the GCM literal type Node's typings require for getAuthTag/setAuthTag
// to be visible — still reads the actual cipher name from env at runtime.
const ALGORITHM = (process.env.MESSAGE_ENCRYPTION_ALGORITHM ??
  "aes-256-gcm") as crypto.CipherGCMTypes;
const IV_LENGTH = Number(process.env.MESSAGE_ENCRYPTION_IV_LENGTH) || 12;
const AUTH_TAG_LENGTH =
  Number(process.env.MESSAGE_ENCRYPTION_AUTH_TAG_LENGTH) || 16;

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not defined");
  cachedKey = crypto.scryptSync(secret, "shoproom-message-encryption-v1", 32);
  return cachedKey;
}

export function encryptText(plainText: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
    "base64",
  );
}

/**
 * Decrypts a value produced by encryptText. Falls back to returning the
 * input unchanged if it isn't valid ciphertext — covers rows written before
 * encryption was introduced, so old messages keep rendering correctly.
 */
export function decryptText(payload: string): string {
  try {
    const buf = Buffer.from(payload, "base64");
    const iv = buf.subarray(0, IV_LENGTH);
    const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return payload;
  }
}
