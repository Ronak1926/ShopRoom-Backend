/**
 * controllers/accountPassword.controller.ts — Forgot password, reset password
 * and change password, for customers and shopkeepers alike. The role is fixed by
 * the route that mounts the handler, so a customer link can never reset a
 * shopkeeper account (and the token row records its role too).
 */

import type { Request, RequestHandler, Response } from "express";
import z from "zod";
import { signCustomerToken, signShopkeeperToken } from "../utils/jwt.js";
import { newPasswordSchema } from "../utils/password.js";
import { recordSecurityEvent } from "../services/securityEvent.service.js";
import {
  changePassword,
  requestPasswordReset,
  resetPassword,
  type ResetRole,
} from "../services/passwordReset.service.js";

const GENERIC_FORGOT_MESSAGE = "If that email has an account, we've sent a link to reset the password.";

const forgotSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) });

const resetSchema = z.object({
  token: z.string().min(20).max(200).regex(/^[A-Za-z0-9_-]+$/),
  password: newPasswordSchema,
});

const changeSchema = z
  .object({ currentPassword: z.string().min(1).max(200), newPassword: newPasswordSchema })
  .refine((v) => v.currentPassword !== v.newPassword, { message: "Choose a different password", path: ["newPassword"] });

export function forgotPasswordHandler(role: ResetRole): RequestHandler {
  return async (req: Request, res: Response) => {
    const parsed = forgotSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Enter a valid email address" });
      return;
    }
    // Answer first, then do the work: the reply is identical and equally fast whether or not the address has an account.
    res.json({ message: GENERIC_FORGOT_MESSAGE });
    await requestPasswordReset(role, parsed.data.email);
  };
}

export function resetPasswordHandler(role: ResetRole): RequestHandler {
  return async (req: Request, res: Response) => {
    const parsed = resetSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Choose a password of 8 to 72 characters" });
      return;
    }
    const accountId = await resetPassword(role, parsed.data.token, parsed.data.password);
    if (!accountId) {
      res.status(400).json({ message: "This reset link is invalid or has expired. Request a new one." });
      return;
    }
    recordSecurityEvent(req, { type: "PASSWORD_RESET", role, actorId: accountId });
    res.json({ message: "Password updated. You can sign in with it now." });
  };
}

export function changePasswordHandler(role: ResetRole): RequestHandler {
  return async (req: Request, res: Response) => {
    const parsed = changeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid request" });
      return;
    }
    const accountId = (role === "CUSTOMER" ? req.customerId : req.shopkeeperId)!;
    const result = await changePassword(role, accountId, parsed.data.currentPassword, parsed.data.newPassword);
    if (!result.ok) {
      if (result.reason === "WRONG_PASSWORD") recordSecurityEvent(req, { type: "REAUTH_FAILED", role, actorId: accountId, detail: { action: "change_password" } });
      res.status(result.reason === "NO_PASSWORD" ? 400 : 403).json({
        message:
          result.reason === "NO_PASSWORD"
            ? "This account signs in with Google and has no password. Use “Forgot password” to set one."
            : "Your current password is not right",
      });
      return;
    }
    recordSecurityEvent(req, { type: "PASSWORD_CHANGED", role, actorId: accountId });
    // Every other session was signed out; hand back a fresh token so this one carries on.
    const token = role === "CUSTOMER" ? signCustomerToken(accountId, result.tokenVersion) : signShopkeeperToken(accountId, result.tokenVersion);
    res.json({ message: "Password changed. Other devices have been signed out.", token });
  };
}
