/**
 * services/passwordReset.service.ts — Forgot-password links and changing a
 * password while signed in.
 *
 * Reset tokens are 32 random bytes; only their SHA-256 is stored, each works once
 * and for 30 minutes, and requesting a new one voids the older ones. The request
 * step never reveals whether an address has an account (the caller answers
 * identically and does this work after replying), and a successful reset signs the
 * account out everywhere.
 */

import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../database/prisma.js";
import { sendPasswordResetEmail } from "../lib/email.js";
import { logger } from "../lib/logger.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { forgetSession } from "./session.service.js";

export type ResetRole = "CUSTOMER" | "SHOPKEEPER";

const TOKEN_TTL_MS = 30 * 60 * 1000;
const REQUEST_COOLDOWN_MS = 60 * 1000;
const SESSION_ROLE = { CUSTOMER: "customer", SHOPKEEPER: "shopkeeper" } as const;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

function frontendBase(): string {
  return (process.env.FRONTEND_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

/** The link in the email. The token is in the fragment so it never reaches a server log or a Referer header. */
export function resetLink(role: ResetRole, token: string): string {
  return `${frontendBase()}/reset-password#token=${token}&role=${role.toLowerCase()}`;
}

async function findAccountId(role: ResetRole, email: string): Promise<string | null> {
  const account =
    role === "CUSTOMER"
      ? await prisma.customer.findUnique({ where: { email }, select: { id: true } })
      : await prisma.shopkeeper.findUnique({ where: { email }, select: { id: true } });
  return account?.id ?? null;
}

/** Sends a reset link if the address has an account. Silent either way; failures are logged, never thrown. */
export async function requestPasswordReset(role: ResetRole, email: string): Promise<void> {
  try {
    const accountId = await findAccountId(role, email);
    if (!accountId) return;

    const recent = await prisma.passwordResetToken.findFirst({
      where: { role, accountId, createdAt: { gt: new Date(Date.now() - REQUEST_COOLDOWN_MS) } },
      select: { id: true },
    });
    if (recent) return;

    const token = randomBytes(32).toString("base64url");
    await prisma.$transaction([
      prisma.passwordResetToken.deleteMany({ where: { role, accountId, usedAt: null } }),
      prisma.passwordResetToken.create({
        data: { role, accountId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + TOKEN_TTL_MS) },
      }),
    ]);
    await sendPasswordResetEmail(email, resetLink(role, token));
  } catch (err) {
    logger.error("Password reset request failed", err);
  }
}

/** Sets a new password from a reset token. Returns false for an unknown, used or expired token. */
export async function resetPassword(role: ResetRole, token: string, newPassword: string): Promise<boolean> {
  const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row || row.role !== role || row.usedAt !== null || row.expiresAt.getTime() <= Date.now()) return false;

  const passwordHash = await hashPassword(newPassword);
  const consumed = await prisma.$transaction(async (tx) => {
    // Single use, even if two requests race with the same token.
    const claimed = await tx.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) return false;
    const data = { passwordHash, tokenVersion: { increment: 1 } };
    if (role === "CUSTOMER") await tx.customer.update({ where: { id: row.accountId }, data: { ...data, emailVerified: true } });
    else await tx.shopkeeper.update({ where: { id: row.accountId }, data });
    await tx.passwordResetToken.deleteMany({ where: { role, accountId: row.accountId, id: { not: row.id } } });
    return true;
  });
  if (consumed) forgetSession(SESSION_ROLE[role], row.accountId);
  return consumed;
}

export type ChangePasswordResult =
  | { ok: true; tokenVersion: number }
  | { ok: false; reason: "WRONG_PASSWORD" | "NO_PASSWORD" };

/** Changes the password of a signed-in account. Every other session is signed out; the caller gets the new token version to keep its own. */
export async function changePassword(
  role: ResetRole,
  accountId: string,
  currentPassword: string,
  newPassword: string,
): Promise<ChangePasswordResult> {
  const account =
    role === "CUSTOMER"
      ? await prisma.customer.findUnique({ where: { id: accountId }, select: { passwordHash: true } })
      : await prisma.shopkeeper.findUnique({ where: { id: accountId }, select: { passwordHash: true } });
  if (!account?.passwordHash) return { ok: false, reason: "NO_PASSWORD" };
  if (!(await verifyPassword(currentPassword, account.passwordHash))) return { ok: false, reason: "WRONG_PASSWORD" };

  const data = { passwordHash: await hashPassword(newPassword), tokenVersion: { increment: 1 } };
  const updated =
    role === "CUSTOMER"
      ? await prisma.customer.update({ where: { id: accountId }, data, select: { tokenVersion: true } })
      : await prisma.shopkeeper.update({ where: { id: accountId }, data, select: { tokenVersion: true } });
  forgetSession(SESSION_ROLE[role], accountId);
  return { ok: true, tokenVersion: updated.tokenVersion };
}
