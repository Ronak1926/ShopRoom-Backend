/**
 * services/mfa.service.ts — Two-step verification with an authenticator app.
 *
 * - The secret is stored encrypted (AES-GCM, same key handling as chat messages).
 * - A code works once: the newest accepted time step is recorded, atomically, so a code seen over
 *   someone's shoulder or replayed in a race cannot be used a second time.
 * - Ten one-time recovery codes cover a lost phone. Only their hashes are stored, and they are
 *   shown exactly once.
 * - Setup is two-phase: the secret is created "pending" and only starts protecting the account
 *   once the person proves their app produces the right code.
 */

import { createHash, randomInt } from "node:crypto";
import type { AccountRole } from "../generated/client.js";
import { prisma } from "../database/prisma.js";
import { decryptText, encryptText } from "../utils/crypto.js";
import { generateTotpSecret, matchTotp, otpauthUrl } from "../utils/totp.js";

const RECOVERY_CODE_COUNT = 10;
const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const where = (role: AccountRole, accountId: string) => ({ role_accountId: { role, accountId } });

function newRecoveryCode(): string {
  const pick = () => Array.from({ length: 5 }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]).join("");
  return `${pick()}-${pick()}`;
}

/** What a person might type: any case, with or without the dash or spaces. */
function normaliseRecoveryCode(input: string): string {
  return input.replace(/[\s-]/g, "").toUpperCase();
}

const hashRecoveryCode = (normalised: string) => createHash("sha256").update(normalised).digest("hex");

export async function isMfaEnabled(role: AccountRole, accountId: string): Promise<boolean> {
  const credential = await prisma.mfaCredential.findUnique({ where: where(role, accountId), select: { enabledAt: true } });
  return credential?.enabledAt != null;
}

export async function mfaStatus(role: AccountRole, accountId: string): Promise<{ enabled: boolean; recoveryCodesLeft: number }> {
  const credential = await prisma.mfaCredential.findUnique({
    where: where(role, accountId),
    select: { enabledAt: true, _count: { select: { recoveryCodes: { where: { usedAt: null } } } } },
  });
  return { enabled: credential?.enabledAt != null, recoveryCodesLeft: credential?.enabledAt ? credential._count.recoveryCodes : 0 };
}

/** Creates (or restarts) a pending secret. Refuses when two-step verification is already on. */
export async function beginMfaSetup(role: AccountRole, accountId: string, accountLabel: string): Promise<{ secret: string; otpauthUrl: string } | "already-enabled"> {
  const existing = await prisma.mfaCredential.findUnique({ where: where(role, accountId), select: { enabledAt: true } });
  if (existing?.enabledAt) return "already-enabled";
  const secret = generateTotpSecret();
  await prisma.mfaCredential.upsert({
    where: where(role, accountId),
    create: { role, accountId, secretEnc: encryptText(secret) },
    update: { secretEnc: encryptText(secret), lastUsedStep: null },
  });
  return { secret, otpauthUrl: otpauthUrl(secret, accountLabel) };
}

async function replaceRecoveryCodes(tx: Pick<typeof prisma, "mfaRecoveryCode">, credentialId: string): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
  await tx.mfaRecoveryCode.deleteMany({ where: { credentialId } });
  await tx.mfaRecoveryCode.createMany({ data: codes.map((code) => ({ credentialId, codeHash: hashRecoveryCode(normaliseRecoveryCode(code)) })) });
  return codes;
}

/** Turns the pending secret on once the person's app produces a valid code. Returns the recovery codes (shown once), or null. */
export async function confirmMfaSetup(role: AccountRole, accountId: string, code: string): Promise<string[] | null> {
  const credential = await prisma.mfaCredential.findUnique({ where: where(role, accountId), select: { id: true, secretEnc: true, enabledAt: true } });
  if (!credential || credential.enabledAt) return null;
  const step = matchTotp(decryptText(credential.secretEnc), code.replace(/\s/g, ""));
  if (step === null) return null;
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.mfaCredential.updateMany({ where: { id: credential.id, enabledAt: null }, data: { enabledAt: new Date(), lastUsedStep: step } });
    if (claimed.count !== 1) return null;
    return replaceRecoveryCodes(tx, credential.id);
  });
}

export type SecondFactor = "totp" | "recovery";

/** Checks the second step at sign-in (or before a sensitive change). A TOTP step, or a recovery code, is accepted once. */
export async function checkSecondFactor(role: AccountRole, accountId: string, input: string): Promise<SecondFactor | null> {
  const credential = await prisma.mfaCredential.findUnique({ where: where(role, accountId), select: { id: true, secretEnc: true, enabledAt: true } });
  if (!credential?.enabledAt) return null;

  const compact = input.replace(/\s/g, "");
  if (/^\d{6}$/.test(compact)) {
    const step = matchTotp(decryptText(credential.secretEnc), compact);
    if (step === null) return null;
    // Atomic: the update only matches if no equal or newer step was accepted before.
    const accepted = await prisma.mfaCredential.updateMany({
      where: { id: credential.id, OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: step } }] },
      data: { lastUsedStep: step },
    });
    return accepted.count === 1 ? "totp" : null;
  }

  const normalised = normaliseRecoveryCode(input);
  if (normalised.length !== 10) return null;
  const used = await prisma.mfaRecoveryCode.updateMany({ where: { credentialId: credential.id, codeHash: hashRecoveryCode(normalised), usedAt: null }, data: { usedAt: new Date() } });
  return used.count === 1 ? "recovery" : null;
}

export async function disableMfa(role: AccountRole, accountId: string): Promise<void> {
  await prisma.mfaCredential.deleteMany({ where: { role, accountId } });
}

/** Replaces the recovery codes with a fresh set (the old ones stop working). Null if two-step verification is off. */
export async function regenerateRecoveryCodes(role: AccountRole, accountId: string): Promise<string[] | null> {
  const credential = await prisma.mfaCredential.findUnique({ where: where(role, accountId), select: { id: true, enabledAt: true } });
  if (!credential?.enabledAt) return null;
  return prisma.$transaction((tx) => replaceRecoveryCodes(tx, credential.id));
}
