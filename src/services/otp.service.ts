import { prisma } from "../database/prisma.js";
import { sendOtpEmail } from "../lib/email.js";
import crypto from "crypto";

function generateOtp(): string {
  // Cryptographically random 6-digit code
  return String(crypto.randomInt(100000, 999999));
}

export async function sendEmailOtp(email: string) {
  const code = generateOtp();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

  // Invalidate any previous unused codes for this email
  await prisma.emailOtp.updateMany({
    where: { email, used: false },
    data: { used: true },
  });

  await prisma.emailOtp.create({
    data: { email, code, expiresAt },
  });

  await sendOtpEmail(email, code);
}

export async function verifyEmailOtp(
  email: string,
  code: string,
): Promise<{ ok: boolean; reason?: string }> {
  const otp = await prisma.emailOtp.findFirst({
    where: { email, code, used: false },
    orderBy: { createdAt: "desc" },
  });

  if (!otp) return { ok: false, reason: "Invalid code" };
  if (otp.expiresAt < new Date())
    return { ok: false, reason: "Code has expired" };

  await prisma.emailOtp.update({ where: { id: otp.id }, data: { used: true } });

  // Mark the customer's email as verified (if they exist yet)
  await prisma.customer.updateMany({
    where: { email },
    data: { emailVerified: true },
  });

  return { ok: true };
}
