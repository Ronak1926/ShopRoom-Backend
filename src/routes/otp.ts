import { Router } from "express";
import { sendOtp, verifyOtp } from "../controllers/otp.controller.js";
import {
  emailOtpSendAccountLimiter,
  emailOtpSendIpLimiter,
  emailOtpVerifyLimiter,
} from "../middleware/rateLimiters.js";

export const otpRouter = Router();

otpRouter.post("/send", emailOtpSendIpLimiter, emailOtpSendAccountLimiter, sendOtp);
otpRouter.post("/verify", emailOtpVerifyLimiter, verifyOtp);
