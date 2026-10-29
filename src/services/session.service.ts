/**
 * services/session.service.ts — Server-side check that a validly signed token
 * still belongs to a live session.
 *
 * A JWT alone can't be revoked, so each account row carries a `tokenVersion`
 * that is copied into the token at login. A token is only honoured while its
 * `tv` equals the row's current value and the row still exists. That gives:
 *   - "sign out everywhere" (bump the version),
 *   - immediate lock-out of deleted accounts,
 *   - a lever for incident response (bump a version, or all of them).
 *
 * Lookups are cached for a few seconds so authenticated traffic isn't one extra
 * query per request. Revocations performed by this process take effect
 * immediately; with several API instances, other instances honour a revoked
 * token for at most CACHE_TTL_MS.
 */

import { prisma } from "../database/prisma.js";

export type SessionRole = "customer" | "shopkeeper";

const CACHE_TTL_MS = 15_000;
const MAX_CACHE_ENTRIES = 10_000;

interface CacheEntry {
  /** null = the account no longer exists. */
  tokenVersion: number | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

const keyOf = (role: SessionRole, id: string) => `${role}:${id}`;

async function loadTokenVersion(role: SessionRole, id: string): Promise<number | null> {
  const row =
    role === "customer"
      ? await prisma.customer.findUnique({ where: { id }, select: { tokenVersion: true } })
      : await prisma.shopkeeper.findUnique({ where: { id }, select: { tokenVersion: true } });
  return row?.tokenVersion ?? null;
}

export async function isSessionActive(
  role: SessionRole,
  id: string,
  tokenVersion: number,
): Promise<boolean> {
  const key = keyOf(role, id);
  const now = Date.now();
  let entry = cache.get(key);
  if (!entry || entry.expiresAt <= now) {
    if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();
    entry = { tokenVersion: await loadTokenVersion(role, id), expiresAt: now + CACHE_TTL_MS };
    cache.set(key, entry);
  }
  return entry.tokenVersion !== null && entry.tokenVersion === tokenVersion;
}

/** Drops the cached view of an account (after it changes or is deleted). */
export function forgetSession(role: SessionRole, id: string): void {
  cache.delete(keyOf(role, id));
}

export function clearSessionCache(): void {
  cache.clear();
}

/** Invalidates every token issued so far for this account. */
export async function revokeSessions(role: SessionRole, id: string): Promise<void> {
  if (role === "customer") {
    await prisma.customer.update({ where: { id }, data: { tokenVersion: { increment: 1 } } });
  } else {
    await prisma.shopkeeper.update({ where: { id }, data: { tokenVersion: { increment: 1 } } });
  }
  forgetSession(role, id);
}
