import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { sendEmailOtp, verifyEmailOtp } from "../services/otp.service.js";

export const otpRouter = Router();

const sendSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
});

const verifySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  code: z.string().length(6),
});

otpRouter.post("/send", async (req: Request, res: Response) => {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid email" });
  }
  try {
    await sendEmailOtp(parsed.data.email);
    return res.json({ message: "OTP sent" });
  } catch (err: any) {
    console.error("OTP send error:", err?.message ?? err);
    return res
      .status(500)
      .json({ message: err?.message ?? "Failed to send OTP" });
  }
});

otpRouter.post("/verify", async (req: Request, res: Response) => {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid request" });
  }
  const result = await verifyEmailOtp(parsed.data.email, parsed.data.code);
  if (!result.ok) {
    return res.status(400).json({ message: result.reason ?? "Invalid code" });
  }
  return res.json({ message: "Email verified" });
});
