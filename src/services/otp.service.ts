import crypto from "node:crypto";
import { prisma } from "../database/prisma.js";
import { sendOtpEmail } from "../lib/email.js";

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
/** Wrong guesses allowed per code; a 6-digit code must not survive a brute-force run. */
export const MAX_OTP_ATTEMPTS = 5;

export class OtpCooldownError extends Error {
  constructor() {
    super("Please wait a minute before requesting another code");
    this.name = "OtpCooldownError";
  }
}

function generateOtp(): string {
  // Cryptographically random, uniformly distributed 6-digit code (leading zeros kept)
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * Codes are stored as an HMAC bound to the email, so a database leak doesn't
 * reveal live codes and a code can't be replayed against another address.
 */
function digest(email: string, code: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not defined");
  const key = crypto.createHmac("sha256", secret).update("shoproom-email-otp-v1").digest();
  return crypto.createHmac("sha256", key).update(`${email}:${code}`).digest("hex");
}

function matches(storedDigest: string, email: string, code: string): boolean {
  const expected = Buffer.from(storedDigest, "hex");
  const received = Buffer.from(digest(email, code), "hex");
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

export async function sendEmailOtp(email: string) {
  const latest = await prisma.emailOtp.findFirst({
    where: { email },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (latest && Date.now() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS) {
    throw new OtpCooldownError();
  }

  const code = generateOtp();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);

  // Invalidate any previous unused codes for this email
  await prisma.emailOtp.updateMany({
    where: { email, used: false },
    data: { used: true },
  });

  const otp = await prisma.emailOtp.create({
    data: { email, code: digest(email, code), expiresAt },
    select: { id: true },
  });

  try {
    await sendOtpEmail(email, code);
  } catch (err) {
    // A code nobody received must not linger as a valid guess target.
    await prisma.emailOtp.update({ where: { id: otp.id }, data: { used: true } });
    throw err;
  }
}

export async function verifyEmailOtp(
  email: string,
  code: string,
): Promise<{ ok: boolean }> {
  const otp = await prisma.emailOtp.findFirst({
    where: { email, used: false },
    orderBy: { createdAt: "desc" },
  });

  if (!otp || otp.expiresAt < new Date() || otp.attempts >= MAX_OTP_ATTEMPTS) {
    return { ok: false };
  }

  if (!matches(otp.code, email, code)) {
    const { attempts } = await prisma.emailOtp.update({
      where: { id: otp.id },
      data: { attempts: { increment: 1 } },
      select: { attempts: true },
    });
    if (attempts >= MAX_OTP_ATTEMPTS) {
      await prisma.emailOtp.update({ where: { id: otp.id }, data: { used: true } });
    }
    return { ok: false };
  }

  // Single use, even if two requests race with the right code.
  const claimed = await prisma.emailOtp.updateMany({
    where: { id: otp.id, used: false },
    data: { used: true },
  });
  if (claimed.count !== 1) return { ok: false };

  // Mark the customer's email as verified (if they exist yet)
  await prisma.customer.updateMany({
    where: { email },
    data: { emailVerified: true },
  });

  return { ok: true };
}
