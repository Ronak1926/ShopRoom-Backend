import type { Request, Response } from "express";
import { z } from "zod";
import { sendEmailOtp, verifyEmailOtp } from "../services/otp.service.js";

const sendSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
});

const verifySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  code: z.string().length(6),
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
    const e = err as Error;
    console.error("OTP send error:", e?.message ?? err);
    res.status(500).json({ message: e?.message ?? "Failed to send OTP" });
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
    res.status(400).json({ message: result.reason ?? "Invalid code" });
    return;
  }
  res.json({ message: "Email verified" });
}
