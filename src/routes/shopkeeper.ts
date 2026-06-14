/**
 * routes/shopkeeper.ts — Route declarations for shopkeeper endpoints.
 * All handler logic lives in controllers/shopkeeper.controller.ts.
 */

import { Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import {
  initDraft,
  updateDraft,
  validatePhone,
  sendPhoneOtpHandler,
  verifyPhoneOtpHandler,
  createPaymentOrder,
  verifyPayment,
  handleWebhook,
  uploadLogo,
  loginShopkeeper,
} from "../controllers/shopkeeper.controller.js";

// -- Rate limiters -------------------------------------------------------------

/** 3 OTP send requests per phone per 10 minutes. */
const otpSendLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 3,
  keyGenerator: (req) =>
    (req.body as { phoneNumber?: string })?.phoneNumber ??
    ipKeyGenerator(req.ip ?? ""),
  message: { message: "Too many OTP requests. Please wait 10 minutes and try again." },
  standardHeaders: true,
  legacyHeaders: false,
});

/** 10 OTP verify attempts per draft per 10 minutes (Twilio rejects after 5 wrong). */
const otpVerifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  keyGenerator: (req) =>
    (req.body as { draftId?: string })?.draftId ?? ipKeyGenerator(req.ip ?? ""),
  message: { message: "Too many verification attempts. Please wait 10 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

// -- Routes --------------------------------------------------------------------

export const shopkeeperRouter = Router();

shopkeeperRouter.post("/draft/init", initDraft);
shopkeeperRouter.put("/draft/:draftId", updateDraft);
shopkeeperRouter.post("/validate-phone", validatePhone);
shopkeeperRouter.post("/phone/send-otp", otpSendLimiter, sendPhoneOtpHandler);
shopkeeperRouter.post("/phone/verify-otp", otpVerifyLimiter, verifyPhoneOtpHandler);
shopkeeperRouter.post("/payment/create-order", createPaymentOrder);
shopkeeperRouter.post("/payment/verify", verifyPayment);
shopkeeperRouter.post("/payment/webhook", handleWebhook);
shopkeeperRouter.post("/upload-logo", uploadLogo);
shopkeeperRouter.post("/login", loginShopkeeper);
