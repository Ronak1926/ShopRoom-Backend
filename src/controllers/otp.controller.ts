import type { Request, Response } from "express";
import { z } from "zod";
import { OtpCooldownError, sendEmailOtp, verifyEmailOtp } from "../services/otp.service.js";
import { logger } from "../lib/logger.js";

const sendSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
});

const verifySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  code: z.string().regex(/^\d{6}$/),
});

export async function sendOtp(req: Request, res: Response): Promise<void> {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid email" });
    return;
  }
  try {
    await sendEmailOtp(parsed.data.email);
    res.json({ message: "OTP sent" });
  } catch (err: unknown) {
    if (err instanceof OtpCooldownError) {
      res.status(429).json({ message: err.message });
      return;
    }
    logger.error("OTP send error", err);
    res.status(500).json({ message: "Failed to send OTP. Please try again." });
  }
}

export async function verifyOtp(req: Request, res: Response): Promise<void> {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid request" });
    return;
  }
  const result = await verifyEmailOtp(parsed.data.email, parsed.data.code);
  if (!result.ok) {
    res.status(400).json({ message: "Invalid or expired code" });
    return;
  }
  res.json({ message: "Email verified" });
}
