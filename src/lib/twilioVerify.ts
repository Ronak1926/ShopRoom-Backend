/**
 * twilioVerify.ts
 *
 * Wraps the Twilio Verify API v2 for phone OTP send and check.
 *
 * WHY VERIFY API INSTEAD OF PLAIN SMS
 * ─────────────────────────────────────
 * • Twilio Verify manages OTP generation, storage, expiry, and retry
 *   limits internally — we store nothing in our own database.
 * • No `from:` phone number required — Verify uses a pool of numbers.
 * • Built-in rate limiting: Twilio rejects after 5 wrong attempts per
 *   verification and limits sends per phone per time window.
 * • `status` field gives structured feedback ("approved" / "pending" /
 *   "canceled" / "max_attempts_reached") instead of raw HTTP errors.
 *
 * SETUP
 * ──────
 * 1. console.twilio.com → Verify → Services → Create Service
 * 2. Copy the "Service SID"  (starts with VA…) → TWILIO_VERIFY_SERVICE_SID
 *
 * DEV FALLBACK
 * ─────────────
 * When TWILIO_* vars are not set the functions log to the console and
 * return success so local development works without Twilio credentials.
 */

import twilio from "twilio";
import { isProduction } from "../config/env.js";
import { logger } from "./logger.js";

// ─── Error class ──────────────────────────────────────────────────────────────

/**
 * Thrown when Twilio Verify rejects the operation for a known reason
 * (wrong code, max attempts, expired, etc.). The message is safe to
 * return directly to the client.
 */
export class VerifyError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
  ) {
    super(message);
    this.name = "VerifyError";
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  return { sid, authToken, serviceSid };
}

/** Keeps phone numbers out of the logs: "+91••••••3210". */
function maskPhone(e164: string): string {
  return `${e164.slice(0, 3)}••••••${e164.slice(-4)}`;
}

function toE164(phoneNumber: string): string {
  // Accepts a raw 10-digit Indian number and prepends country code
  return `+91${phoneNumber}`;
}

// ─── Send OTP ─────────────────────────────────────────────────────────────────

/**
 * Sends a one-time passcode to `phoneNumber` via Twilio Verify.
 *
 * Twilio handles:
 *  • OTP generation (6 digits by default, configurable in Verify Service settings)
 *  • Delivery via SMS (or call, WhatsApp — configurable per-request via `channel`)
 *  • Expiry (10 minutes by default)
 *  • Per-phone send throttling
 *
 * @param phoneNumber  10-digit Indian mobile number WITHOUT country code
 */
export async function sendVerifyOtp(phoneNumber: string): Promise<void> {
  const { sid, authToken, serviceSid } = getClient();

  if (!sid || !authToken || !serviceSid) {
    // Never let a missing credential turn phone verification into a no-op in production.
    if (isProduction()) throw new VerifyError("Phone verification is temporarily unavailable.");
    logger.warn("Twilio Verify not configured: OTP not sent, number treated as verified (development only)");
    return;
  }

  const client = twilio(sid, authToken);
  const to = toE164(phoneNumber);

  try {
    const verification = await client.verify.v2
      .services(serviceSid)
      .verifications.create({ to, channel: "sms" });

    // "pending" is the only successful status after a send
    if (verification.status !== "pending") {
      throw new VerifyError(
        `Unexpected verification status: ${verification.status}`,
      );
    }

    logger.info("Phone OTP sent", { to: maskPhone(to), status: verification.status });
  } catch (err: unknown) {
    const e = err as { code?: number; message?: string; status?: number };

    // Re-throw our own errors directly
    if (err instanceof VerifyError) throw err;

    // Twilio error codes we translate to user-friendly messages:
    // 60200 – Invalid parameter (bad phone format)
    // 60203 – Max send attempts reached
    // 60212 – Too many concurrent requests for this phone number
    if (e.code === 60200) throw new VerifyError("Invalid phone number");
    if (e.code === 60203)
      throw new VerifyError(
        "Too many OTP requests for this number. Please try again later.",
        e.code,
      );
    if (e.code === 60212)
      throw new VerifyError(
        "Too many requests. Please wait a moment and try again.",
        e.code,
      );

    // Unexpected error — log and rethrow a safe message
    logger.error("Twilio Verify send failed", err);
    throw new VerifyError("Failed to send OTP. Please try again.");
  }
}

// ─── Check OTP ────────────────────────────────────────────────────────────────

/**
 * Verifies the OTP code entered by the user against Twilio Verify.
 *
 * Returns `true` if the code is correct and `status === "approved"`.
 * Throws a `VerifyError` for known failures (wrong code, max attempts, etc.).
 *
 * Twilio automatically:
 *  • Marks the verification as "canceled" after 5 wrong attempts
 *  • Marks the verification as "expired" after 10 minutes
 *
 * @param phoneNumber  Same 10-digit number used in sendVerifyOtp
 * @param code         The 6-digit code entered by the user
 */
export async function checkVerifyOtp(
  phoneNumber: string,
  code: string,
): Promise<boolean> {
  const { sid, authToken, serviceSid } = getClient();

  if (!sid || !authToken || !serviceSid) {
    if (isProduction()) throw new VerifyError("Phone verification is temporarily unavailable.");
    // Dev fallback: accept any 6-digit code
    logger.warn("Twilio Verify not configured: accepting any code (development only)");
    return true;
  }

  const client = twilio(sid, authToken);
  const to = toE164(phoneNumber);

  try {
    const check = await client.verify.v2
      .services(serviceSid)
      .verificationChecks.create({ to, code });

    // Possible statuses after a check:
    //   "approved"            → correct code ✅
    //   "pending"             → wrong code (attempts remain)
    //   "canceled"            → max wrong attempts (5) reached
    //   "max_attempts_reached"→ alias for canceled
    //   "expired"             → 10 minutes passed
    switch (check.status) {
      case "approved":
        logger.info("Phone OTP approved", { to: maskPhone(to) });
        return true;

      case "pending":
        throw new VerifyError("Incorrect code. Please try again.");

      case "canceled":
      case "max_attempts_reached":
        throw new VerifyError(
          "Too many incorrect attempts. Please request a new OTP.",
        );

      case "expired":
        throw new VerifyError(
          "This code has expired. Please request a new OTP.",
        );

      default:
        throw new VerifyError(`Verification failed (status: ${check.status})`);
    }
  } catch (err: unknown) {
    const e = err as { code?: number; message?: string };

    if (err instanceof VerifyError) throw err;

    // 20404 – verification not found (phone number never had an OTP sent,
    //         or already approved/expired and Twilio purged the record)
    if (e.code === 20404)
      throw new VerifyError(
        "No active OTP found for this number. Please request a new one.",
      );

    logger.error("Twilio Verify check failed", err);
    throw new VerifyError("Verification failed. Please try again.");
  }
}
