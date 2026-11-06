/**
 * middleware/rateLimiters.ts — Throttles for every unauthenticated or
 * abuse-prone endpoint.
 *
 * Credential endpoints are limited twice: per client IP (stops one machine
 * trying many accounts) and per target account (stops a botnet trying many
 * passwords on one account). Keys are truncated so a client can't grow the
 * counter table with huge strings.
 *
 * WHERE THE COUNTERS LIVE. The default in-memory store is per process: behind N
 * API instances an attacker would get N times every budget below. So the
 * security-critical limiters (sign-in, sign-up, OTP, drafts, payments, uploads)
 * use a shared store backed by Postgres (see postgresRateLimitStore.ts), while
 * the high-volume global backstop and the invite preview stay in memory, where
 * a per-instance budget is fine.
 *
 * RATE_LIMIT_STORE=postgres|memory picks the shared store's backend; unset it is
 * `postgres` in production and `memory` in development and tests.
 */

import type { Request } from "express";
import { ipKeyGenerator, rateLimit, type Store } from "express-rate-limit";
import { isProduction } from "../config/env.js";
import { PostgresRateLimitStore } from "./postgresRateLimitStore.js";

const MINUTE = 60 * 1000;
const MAX_KEY_LENGTH = 254;

export function rateLimitStoreMode(env: Record<string, string | undefined> = process.env): "postgres" | "memory" {
  const configured = env.RATE_LIMIT_STORE;
  if (configured === "postgres" || configured === "memory") return configured;
  return isProduction(env) ? "postgres" : "memory";
}

const mode = rateLimitStoreMode();

/** A counter store shared by every API instance, or undefined (= per-process memory) when so configured. */
export function sharedStore(name: string): Store | undefined {
  return mode === "postgres" ? new PostgresRateLimitStore(name) : undefined;
}

function clientIp(req: Request): string {
  return ipKeyGenerator(req.ip ?? "");
}

function bodyField(req: Request, field: string): string {
  const value = (req.body as Record<string, unknown> | undefined)?.[field];
  return typeof value === "string" ? value.trim().toLowerCase().slice(0, MAX_KEY_LENGTH) : "";
}

function limiter(
  name: string,
  windowMs: number,
  limit: number,
  message: string,
  key: (req: Request) => string = clientIp,
  { shared = true }: { shared?: boolean } = {},
) {
  return rateLimit({
    windowMs,
    limit,
    keyGenerator: key,
    message: { message },
    standardHeaders: true,
    legacyHeaders: false,
    ...(shared ? { store: sharedStore(name) } : {}),
  });
}

/** Backstop for the whole API (every request); per-process on purpose. Routes below are far stricter. */
export const globalLimiter = limiter("global", MINUTE, 300, "Too many requests. Please slow down.", clientIp, {
  shared: false,
});

const LOGIN_MESSAGE = "Too many login attempts. Please wait a few minutes and try again.";
export const loginIpLimiter = limiter("login-ip", 15 * MINUTE, 40, LOGIN_MESSAGE);
export const loginAccountLimiter = limiter(
  "login-account",
  15 * MINUTE,
  8,
  LOGIN_MESSAGE,
  (req) => `acct:${bodyField(req, "email")}|${clientIp(req)}`,
);

/** The account named by the (signed) token in a second-step request; falls back to the client address. */
function pendingAccount(req: Request): string {
  const token = (req.body as Record<string, unknown> | undefined)?.mfaToken;
  if (typeof token === "string") {
    try {
      const sub = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")).sub;
      if (typeof sub === "string") return sub.slice(0, 64);
    } catch {
      // Not a token: the handler will refuse it; the limiter still counts it against the address.
    }
  }
  return clientIp(req);
}
const MFA_MESSAGE = "Too many attempts. Please wait a few minutes and try again.";
export const mfaLoginIpLimiter = limiter("mfa-login-ip", 15 * MINUTE, 40, MFA_MESSAGE);
/** Per account, from any address: a six-digit code must not be guessable by spreading attempts over many clients. */
export const mfaLoginAccountLimiter = limiter("mfa-login-account", 15 * MINUTE, 8, MFA_MESSAGE, (req) => `mfa:${pendingAccount(req)}`);
export const mfaManageLimiter = limiter("mfa-manage", 60 * MINUTE, 20, MFA_MESSAGE, (req) => `mfa-manage:${req.customerId ?? req.shopkeeperId ?? clientIp(req)}`);

export const registerLimiter = limiter(
  "register",
  60 * MINUTE,
  15,
  "Too many sign-up attempts. Please try again later.",
);

const FORGOT_MESSAGE = "Too many reset requests. Please wait a few minutes and try again.";
export const forgotPasswordIpLimiter = limiter("forgot-ip", 60 * MINUTE, 10, FORGOT_MESSAGE);
export const forgotPasswordAccountLimiter = limiter(
  "forgot-account",
  60 * MINUTE,
  3,
  FORGOT_MESSAGE,
  (req) => `forgot:${bodyField(req, "email")}`,
);
export const resetPasswordLimiter = limiter("reset-password", 15 * MINUTE, 10, "Too many attempts. Please wait a few minutes and try again.");
export const changePasswordLimiter = limiter(
  "change-password",
  15 * MINUTE,
  6,
  "Too many attempts. Please wait a few minutes and try again.",
  (req) => `change:${req.customerId ?? req.shopkeeperId ?? clientIp(req)}`,
);

export const googleAuthLimiter = limiter("google-auth", 15 * MINUTE, 40, LOGIN_MESSAGE);

export const emailOtpSendIpLimiter = limiter(
  "email-otp-send-ip",
  60 * MINUTE,
  10,
  "Too many verification emails requested. Please try again later.",
);
export const emailOtpSendAccountLimiter = limiter(
  "email-otp-send-account",
  10 * MINUTE,
  3,
  "Too many verification emails requested. Please wait 10 minutes.",
  (req) => `otp-send:${bodyField(req, "email")}`,
);
export const emailOtpVerifyLimiter = limiter(
  "email-otp-verify",
  10 * MINUTE,
  10,
  "Too many verification attempts. Please wait 10 minutes.",
  (req) => `otp-verify:${bodyField(req, "email")}|${clientIp(req)}`,
);

/** Stops one client using the SMS endpoint to text many different numbers. */
export const phoneOtpSendIpLimiter = limiter(
  "phone-otp-send-ip",
  60 * MINUTE,
  10,
  "Too many OTP requests. Please try again later.",
);

export const draftLimiter = limiter(
  "draft",
  15 * MINUTE,
  30,
  "Too many requests. Please wait a few minutes and try again.",
);
export const draftInitAccountLimiter = limiter(
  "draft-init-account",
  15 * MINUTE,
  8,
  "Too many attempts. Please wait a few minutes and try again.",
  (req) => `draft:${bodyField(req, "email")}|${clientIp(req)}`,
);

export const paymentLimiter = limiter("payment", 10 * MINUTE, 30, "Too many payment requests. Please wait.");

export const logoUploadLimiter = limiter("logo-upload", 60 * MINUTE, 10, "Too many uploads. Please try again later.");

export const invitePreviewLimiter = limiter(
  "invite-preview",
  MINUTE,
  60,
  "Too many requests. Please slow down.",
  clientIp,
  { shared: false },
);

export const accountDeletionLimiter = limiter(
  "account-deletion",
  15 * MINUTE,
  5,
  "Too many attempts. Please wait a few minutes and try again.",
  (req) => `delete:${req.customerId ?? req.shopkeeperId ?? clientIp(req)}`,
);

export const dataExportLimiter = limiter(
  "data-export",
  60 * MINUTE,
  5,
  "You've downloaded your data several times already. Please try again later.",
  (req) => `export:${req.customerId ?? req.shopkeeperId ?? clientIp(req)}`,
);

export const contactLimiter = limiter(
  "contact",
  60 * MINUTE,
  5,
  "You've sent several messages already. Please try again later.",
);
export const newsletterLimiter = limiter(
  "newsletter",
  60 * MINUTE,
  10,
  "Too many sign-up attempts. Please try again later.",
);
export const newsletterUnsubscribeLimiter = limiter(
  "newsletter-unsubscribe",
  60 * MINUTE,
  30,
  "Too many attempts. Please try again later.",
);
