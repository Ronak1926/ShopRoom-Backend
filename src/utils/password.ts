/**
 * utils/password.ts — The one place passwords are hashed and checked.
 *
 * - Cost 12 (OWASP: at least 10). Older, cheaper hashes are upgraded
 *   transparently the next time their owner logs in.
 * - bcrypt silently ignores everything after 72 bytes, so new passwords are
 *   capped at 72 bytes instead of letting two different long passwords collide.
 * - verifyPassword always performs a bcrypt comparison, even when there is no
 *   account or no password, so response time doesn't reveal which emails exist.
 */

import bcrypt from "bcrypt";
import z from "zod";

export const BCRYPT_COST = 12;
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_BYTES = 72;

/** Schema for choosing a new password (registration). Login accepts anything non-empty. */
export const newPasswordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH)
  .refine((value) => Buffer.byteLength(value, "utf8") <= MAX_PASSWORD_BYTES, {
    message: `Password must be at most ${MAX_PASSWORD_BYTES} bytes`,
  });

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

let dummyHash: Promise<string> | null = null;

export async function verifyPassword(
  plain: string,
  hash: string | null | undefined,
): Promise<boolean> {
  if (!hash) {
    dummyHash ??= hashPassword("shoproom-timing-equaliser");
    await bcrypt.compare(plain, await dummyHash);
    return false;
  }
  return bcrypt.compare(plain, hash);
}

/** True when `hash` was made with a cheaper cost than we use today. */
export function needsRehash(hash: string): boolean {
  try {
    return bcrypt.getRounds(hash) < BCRYPT_COST;
  } catch {
    return false;
  }
}
