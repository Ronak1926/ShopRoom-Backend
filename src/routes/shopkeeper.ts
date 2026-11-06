/**
 * routes/shopkeeper.ts � Route declarations for shopkeeper endpoints.
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
  uploadLogo,
  loginShopkeeper,
  logoutAllShopkeeperHandler,
  deleteShopkeeperAccountHandler,
} from "../controllers/shopkeeper.controller.js";
import { createPaymentOrder, handleWebhook, verifyPayment } from "../controllers/payment.controller.js";
import { exportShopkeeperDataHandler } from "../controllers/dataExport.controller.js";
import { requireShopkeeperAuth } from "../middleware/shopkeeperAuth.js";
import {
  changePasswordHandler,
  forgotPasswordHandler,
  resetPasswordHandler,
} from "../controllers/accountPassword.controller.js";
import { createRenewalOrderHandler, getBillingHandler, verifyRenewalHandler } from "../controllers/billing.controller.js";
import {
  accountDeletionLimiter,
  dataExportLimiter,
  changePasswordLimiter,
  draftInitAccountLimiter,
  draftLimiter,
  forgotPasswordAccountLimiter,
  forgotPasswordIpLimiter,
  logoUploadLimiter,
  loginAccountLimiter,
  loginIpLimiter,
  paymentLimiter,
  phoneOtpSendIpLimiter,
  resetPasswordLimiter,
  sharedStore,
} from "../middleware/rateLimiters.js";

// -- Rate limiters -------------------------------------------------------------

const MAX_KEY_LENGTH = 64;

/** 3 OTP send requests per phone per 10 minutes. */
const otpSendLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 3,
  keyGenerator: (req) => {
    const phone = (req.body as { phoneNumber?: unknown } | undefined)?.phoneNumber;
    return typeof phone === "string" ? phone.slice(0, MAX_KEY_LENGTH) : ipKeyGenerator(req.ip ?? "");
  },
  message: { message: "Too many OTP requests. Please wait 10 minutes and try again." },
  standardHeaders: true,
  legacyHeaders: false,
  store: sharedStore("phone-otp-send-number"),
});

/** 10 OTP verify attempts per draft per 10 minutes (Twilio rejects after 5 wrong). */
const otpVerifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => {
    const draftId = (req.body as { draftId?: unknown } | undefined)?.draftId;
    return typeof draftId === "string" ? draftId.slice(0, MAX_KEY_LENGTH) : ipKeyGenerator(req.ip ?? "");
  },
  message: { message: "Too many verification attempts. Please wait 10 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
  store: sharedStore("phone-otp-verify-draft"),
});

// -- Routes --------------------------------------------------------------------

export const shopkeeperRouter = Router();

shopkeeperRouter.post("/draft/init", draftLimiter, draftInitAccountLimiter, initDraft);
shopkeeperRouter.put("/draft/:draftId", draftLimiter, updateDraft);
shopkeeperRouter.post("/validate-phone", draftLimiter, validatePhone);
shopkeeperRouter.post(
  "/phone/send-otp",
  phoneOtpSendIpLimiter,
  otpSendLimiter,
  sendPhoneOtpHandler,
);
shopkeeperRouter.post("/phone/verify-otp", draftLimiter, otpVerifyLimiter, verifyPhoneOtpHandler);
shopkeeperRouter.post("/payment/create-order", paymentLimiter, createPaymentOrder);
shopkeeperRouter.post("/payment/verify", paymentLimiter, verifyPayment);
shopkeeperRouter.post("/payment/webhook", handleWebhook);
shopkeeperRouter.post("/upload-logo", logoUploadLimiter, uploadLogo);
shopkeeperRouter.post("/login", loginIpLimiter, loginAccountLimiter, loginShopkeeper);

shopkeeperRouter.post("/forgot-password", forgotPasswordIpLimiter, forgotPasswordAccountLimiter, forgotPasswordHandler("SHOPKEEPER"));
shopkeeperRouter.post("/reset-password", resetPasswordLimiter, resetPasswordHandler("SHOPKEEPER"));
shopkeeperRouter.patch("/me/password", requireShopkeeperAuth, changePasswordLimiter, changePasswordHandler("SHOPKEEPER"));
shopkeeperRouter.get("/billing", requireShopkeeperAuth, getBillingHandler);
shopkeeperRouter.post("/billing/order", requireShopkeeperAuth, paymentLimiter, createRenewalOrderHandler);
shopkeeperRouter.post("/billing/verify", requireShopkeeperAuth, paymentLimiter, verifyRenewalHandler);
shopkeeperRouter.post("/logout-all", requireShopkeeperAuth, logoutAllShopkeeperHandler);
shopkeeperRouter.post("/me/export", requireShopkeeperAuth, dataExportLimiter, exportShopkeeperDataHandler);
shopkeeperRouter.delete(
  "/me",
  requireShopkeeperAuth,
  accountDeletionLimiter,
  deleteShopkeeperAccountHandler,
);
