/**
 * controllers/mfa.controller.ts — Two-step verification: turning it on and off, recovery codes, and
 * the second step of signing in.
 *
 * Changing the setting needs the password again (or a fresh Google sign-in): a stolen session must
 * not be able to switch the protection off, or switch it on for the thief's own phone. Turning it
 * off or replacing recovery codes also needs a current code.
 */

import type { Request, RequestHandler, Response } from "express";
import z from "zod";
import type { AccountRole } from "../generated/client.js";
import { prisma } from "../database/prisma.js";
import { logger } from "../lib/logger.js";
import { sendSession } from "../lib/sessionCookie.js";
import { signCustomerToken, signShopkeeperToken, verifyMfaPendingToken } from "../utils/jwt.js";
import { beginMfaSetup, checkSecondFactor, confirmMfaSetup, disableMfa, mfaStatus, regenerateRecoveryCodes } from "../services/mfa.service.js";
import { confirmCustomerIdentity, confirmShopkeeperIdentity } from "../services/reauth.service.js";
import { recordSecurityEvent } from "../services/securityEvent.service.js";

const proofShape = { password: z.string().min(1).max(200).optional(), idToken: z.string().min(10).max(4096).optional() };
const proofSchema = z.object(proofShape);
const proofWithCodeSchema = z.object({ ...proofShape, code: z.string().min(1).max(32) });
const codeSchema = z.object({ code: z.string().min(1).max(32) });
const loginSchema = z.object({ mfaToken: z.string().min(10).max(2000), code: z.string().min(1).max(32) });

const accountId = (role: AccountRole, req: Request) => (role === "CUSTOMER" ? req.customerId : req.shopkeeperId)!;

async function accountEmail(role: AccountRole, id: string): Promise<string | null> {
  const row =
    role === "CUSTOMER"
      ? await prisma.customer.findUnique({ where: { id }, select: { email: true } })
      : await prisma.shopkeeper.findUnique({ where: { id }, select: { email: true } });
  return row?.email ?? null;
}

/** True when the person proved who they are; otherwise the response has been sent. */
async function reauthenticated(role: AccountRole, req: Request, res: Response, proof: { password?: string; idToken?: string }, action: string): Promise<boolean> {
  const id = accountId(role, req);
  const result =
    role === "CUSTOMER"
      ? await confirmCustomerIdentity(id, proof)
      : proof.password
        ? await confirmShopkeeperIdentity(id, proof.password)
        : "denied";
  if (result === "confirmed") return true;
  if (result === "not-found") {
    res.status(404).json({ message: "Account not found" });
  } else {
    recordSecurityEvent(req, { type: "REAUTH_FAILED", role, actorId: id, detail: { action } });
    res.status(403).json({ message: "Could not confirm your identity" });
  }
  return false;
}

export function mfaHandlers(role: AccountRole) {
  const status: RequestHandler = async (req, res) => {
    res.json({ data: await mfaStatus(role, accountId(role, req)) });
  };

  const setup: RequestHandler = async (req, res) => {
    const parsed = proofSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Enter your password to continue" });
      return;
    }
    if (!(await reauthenticated(role, req, res, parsed.data, "enable_mfa"))) return;
    const id = accountId(role, req);
    const email = await accountEmail(role, id);
    if (!email) {
      res.status(404).json({ message: "Account not found" });
      return;
    }
    const started = await beginMfaSetup(role, id, email);
    if (started === "already-enabled") {
      res.status(409).json({ message: "Two-step verification is already on." });
      return;
    }
    res.json({ data: started });
  };

  const enable: RequestHandler = async (req, res) => {
    const parsed = codeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Enter the 6-digit code from your app" });
      return;
    }
    const id = accountId(role, req);
    const recoveryCodes = await confirmMfaSetup(role, id, parsed.data.code);
    if (!recoveryCodes) {
      res.status(400).json({ message: "That code isn't right. Check the time on your phone and try the next code." });
      return;
    }
    recordSecurityEvent(req, { type: "MFA_ENABLED", role, actorId: id });
    res.json({ data: { recoveryCodes } });
  };

  const disable: RequestHandler = async (req, res) => {
    const parsed = proofWithCodeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Enter your password and a code from your app" });
      return;
    }
    if (!(await reauthenticated(role, req, res, parsed.data, "disable_mfa"))) return;
    const id = accountId(role, req);
    if (!(await checkSecondFactor(role, id, parsed.data.code))) {
      recordSecurityEvent(req, { type: "MFA_FAILED", role, actorId: id, detail: { action: "disable_mfa" } });
      res.status(403).json({ message: "That code isn't right." });
      return;
    }
    await disableMfa(role, id);
    recordSecurityEvent(req, { type: "MFA_DISABLED", role, actorId: id });
    res.json({ message: "Two-step verification is off." });
  };

  const recoveryCodes: RequestHandler = async (req, res) => {
    const parsed = proofWithCodeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Enter your password and a code from your app" });
      return;
    }
    if (!(await reauthenticated(role, req, res, parsed.data, "recovery_codes"))) return;
    const id = accountId(role, req);
    if (!(await checkSecondFactor(role, id, parsed.data.code))) {
      recordSecurityEvent(req, { type: "MFA_FAILED", role, actorId: id, detail: { action: "recovery_codes" } });
      res.status(403).json({ message: "That code isn't right." });
      return;
    }
    const codes = await regenerateRecoveryCodes(role, id);
    if (!codes) {
      res.status(409).json({ message: "Two-step verification is not on." });
      return;
    }
    res.json({ data: { recoveryCodes: codes } });
  };

  /** POST /login/mfa — the second step. Redeems the short-lived token from the password step. */
  const completeLogin: RequestHandler = async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Enter the 6-digit code from your app" });
      return;
    }
    let pending;
    try {
      pending = verifyMfaPendingToken(parsed.data.mfaToken);
    } catch {
      res.status(401).json({ message: "Your sign-in timed out. Please start again." });
      return;
    }
    if (pending.role !== role) {
      res.status(401).json({ message: "Your sign-in timed out. Please start again." });
      return;
    }
    try {
      const account =
        role === "CUSTOMER"
          ? await prisma.customer.findUnique({ where: { id: pending.sub }, select: { id: true, tokenVersion: true } })
          : await prisma.shopkeeper.findUnique({ where: { id: pending.sub }, select: { id: true, tokenVersion: true, shopName: true } });
      // A password change or "sign out everywhere" since the password step voids it.
      if (!account || account.tokenVersion !== pending.tv) {
        res.status(401).json({ message: "Your sign-in timed out. Please start again." });
        return;
      }
      const factor = await checkSecondFactor(role, account.id, parsed.data.code);
      if (!factor) {
        recordSecurityEvent(req, { type: "MFA_FAILED", role, actorId: account.id, detail: { action: "login" } });
        res.status(401).json({ message: "That code isn't right. Check the time on your phone, or use a recovery code." });
        return;
      }
      recordSecurityEvent(req, { type: "LOGIN_SUCCESS", role, actorId: account.id, detail: { method: "password", mfa: factor } });
      if (factor === "recovery") recordSecurityEvent(req, { type: "MFA_RECOVERY_USED", role, actorId: account.id });

      if (role === "CUSTOMER") {
        sendSession(req, res, "customer", signCustomerToken(account.id, account.tokenVersion), { customerId: account.id });
      } else {
        const shop = account as { id: string; tokenVersion: number; shopName: string };
        sendSession(req, res, "shopkeeper", signShopkeeperToken(shop.id, shop.tokenVersion), { shopkeeperId: shop.id, shopName: shop.shopName });
      }
    } catch (err) {
      logger.error("Two-step sign-in", err);
      res.status(500).json({ message: "Sign-in failed. Please try again." });
    }
  };

  return { status, setup, enable, disable, recoveryCodes, completeLogin };
}
