import { Router } from "express";
import { sendOtp, verifyOtp } from "../controllers/otp.controller.js";

export const otpRouter = Router();

otpRouter.post("/send", sendOtp);
otpRouter.post("/verify", verifyOtp);
