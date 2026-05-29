/**
 * utils/inviteCode.ts — Unique invite code generation with collision prevention.
 *
 * Codes are 8 characters of unambiguous uppercase alphanumerics.
 * Excluded characters: 0 (zero), O (letter), I (letter), 1 (one)
 * — avoids visual confusion in printed/shared links.
 *
 * Format: /join/ABCD2345
 *
 * Collision prevention: up to MAX_ATTEMPTS DB checks before throwing.
 * At 8 chars from a 30-char alphabet, keyspace = 30^8 ≈ 656 billion.
 * Collision probability is negligible in practice.
 */

import type { PrismaClient } from "../generated/client.js";

// Unambiguous characters — no 0, O, I, 1
const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const MAX_ATTEMPTS = 10;

type TxClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/**
 * Generates a cryptographically random invite code character.
 *
 * Uses Math.random() — sufficient for non-security-critical invite codes.
 * If codes ever need to be unguessable secrets, swap in crypto.randomInt.
 */
function randomCode(): string {
  return Array.from(
    { length: CODE_LENGTH },
    () => CHARS[Math.floor(Math.random() * CHARS.length)],
  ).join("");
}

/**
 * Generates a unique invite code, checking the database for collisions.
 *
 * @param tx  — Prisma client or interactive transaction client.
 * @throws    — After MAX_ATTEMPTS failed uniqueness checks (should never happen).
 */
export async function generateUniqueInviteCode(tx: TxClient): Promise<string> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const code = randomCode();
    const existing = await tx.room.findUnique({ where: { inviteCode: code } });
    if (!existing) return code;
    console.warn(`[inviteCode] collision on attempt ${attempt}: ${code}`);
  }

  throw new Error(
    `Failed to generate a unique invite code after ${MAX_ATTEMPTS} attempts.`,
  );
}

/**
 * Builds the shareable invite URL.
 *
 * @param code       — The 8-char invite code.
 * @param baseUrl    — e.g. "https://shoproom.com". Defaults to env var or localhost.
 */
export function buildInviteLink(code: string, baseUrl?: string): string {
  const base =
    baseUrl ?? process.env.FRONTEND_BASE_URL ?? "http://localhost:3000";
  return `${base}/join/${code}`;
}
