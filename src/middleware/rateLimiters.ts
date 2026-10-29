/**
 * middleware/rateLimiters.ts — Throttles for every unauthenticated or
 * abuse-prone endpoint.
 *
 * Counters live in this process's memory, so with several API instances each
 * enforces its own budget; move to a shared store before scaling horizontally.
 *
 * Credential endpoints are limited twice: per client IP (stops one machine
 * trying many accounts) and per target account (stops a botnet trying many
 * passwords on one account). Keys are truncated so a client can't grow the
 * counter table with huge strings.
 */

import type { Request } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";

const MINUTE = 60 * 1000;
const MAX_KEY_LENGTH = 254;

function clientIp(req: Request): string {
  return ipKeyGenerator(req.ip ?? "");
}

function bodyField(req: Request, field: string): string {
  const value = (req.body as Record<string, unknown> | undefined)?.[field];
  return typeof value === "string" ? value.trim().toLowerCase().slice(0, MAX_KEY_LENGTH) : "";
}

function limiter(
  windowMs: number,
  limit: number,
  message: string,
  key: (req: Request) => string = clientIp,
) {
  return rateLimit({
    windowMs,
    limit,
    keyGenerator: key,
    message: { message },
    standardHeaders: true,
    legacyHeaders: false,
  });
}

/** Backstop for the whole API; individual routes below are far stricter. */
export const globalLimiter = limiter(MINUTE, 300, "Too many requests. Please slow down.");

const LOGIN_MESSAGE = "Too many login attempts. Please wait a few minutes and try again.";
export const loginIpLimiter = limiter(15 * MINUTE, 40, LOGIN_MESSAGE);
export const loginAccountLimiter = limiter(
  15 * MINUTE,
  8,
  LOGIN_MESSAGE,
  (req) => `acct:${bodyField(req, "email")}|${clientIp(req)}`,
);

export const registerLimiter = limiter(
  60 * MINUTE,
  15,
  "Too many sign-up attempts. Please try again later.",
);

export const googleAuthLimiter = limiter(15 * MINUTE, 40, LOGIN_MESSAGE);

export const emailOtpSendIpLimiter = limiter(
  60 * MINUTE,
  10,
  "Too many verification emails requested. Please try again later.",
);
export const emailOtpSendAccountLimiter = limiter(
  10 * MINUTE,
  3,
  "Too many verification emails requested. Please wait 10 minutes.",
  (req) => `otp-send:${bodyField(req, "email")}`,
);
export const emailOtpVerifyLimiter = limiter(
  10 * MINUTE,
  10,
  "Too many verification attempts. Please wait 10 minutes.",
  (req) => `otp-verify:${bodyField(req, "email")}|${clientIp(req)}`,
);

/** Stops one client using the SMS endpoint to text many different numbers. */
export const phoneOtpSendIpLimiter = limiter(
  60 * MINUTE,
  10,
  "Too many OTP requests. Please try again later.",
);

export const draftLimiter = limiter(
  15 * MINUTE,
  30,
  "Too many requests. Please wait a few minutes and try again.",
);
export const draftInitAccountLimiter = limiter(
  15 * MINUTE,
  8,
  "Too many attempts. Please wait a few minutes and try again.",
  (req) => `draft:${bodyField(req, "email")}|${clientIp(req)}`,
);

export const paymentLimiter = limiter(10 * MINUTE, 30, "Too many payment requests. Please wait.");

export const logoUploadLimiter = limiter(60 * MINUTE, 10, "Too many uploads. Please try again later.");

export const invitePreviewLimiter = limiter(MINUTE, 60, "Too many requests. Please slow down.");

export const accountDeletionLimiter = limiter(
  15 * MINUTE,
  5,
  "Too many attempts. Please wait a few minutes and try again.",
  (req) => `delete:${req.customerId ?? req.shopkeeperId ?? clientIp(req)}`,
);
