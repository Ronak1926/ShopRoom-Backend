import { Router } from "express";
import type { Request, Response } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";
import bcrypt from "bcrypt";
import {
  initShopkeeperDraft,
  updateShopkeeperDraft,
  sendPhoneOtp,
  verifyPhoneOtp,
  createOrder,
  verifyPaymentAndRegister,
} from "../services/shopkeeper.service.js";
import { uploadLogoToCloudinary } from "../lib/cloudinary.js";
import { validatePhoneNumber } from "../lib/phoneValidation.js";
import { VerifyError } from "../lib/twilioVerify.js";
import { verifyWebhookSignature } from "../lib/razorpay.js";
import { signShopkeeperToken } from "../lib/jwt.js";
import { prisma } from "../database/prisma.js";

// ─── Error sanitizer ──────────────────────────────────────────────────────────
// Prevents raw Prisma / DB error details from leaking to the client.
// Prisma errors carry a name like "PrismaClientValidationError" or a P-code like P2002.
function safeMessage(
  err: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  const e = err as any;
  if (typeof e?.name === "string" && e.name.startsWith("PrismaClient"))
    return fallback;
  if (typeof e?.code === "string" && /^P\d{4}$/.test(e.code)) return fallback;
  return e?.message ?? fallback;
}

// ─── Rate limiters ────────────────────────────────────────────────────────────

/** 3 OTP send requests per phone per 10 minutes. */
const otpSendLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 3,
  keyGenerator: (req) =>
    // Key by phone number when available, fall back to IP (ipKeyGenerator handles IPv6)
    (req.body as { phoneNumber?: string })?.phoneNumber ??
    ipKeyGenerator(req.ip ?? ""),
  message: {
    message: "Too many OTP requests. Please wait 10 minutes and try again.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/** 10 OTP verify attempts per phone per 10 minutes (Twilio rejects after 5 wrong). */
const otpVerifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  keyGenerator: (req) =>
    (req.body as { draftId?: string })?.draftId ?? ipKeyGenerator(req.ip ?? ""),
  message: {
    message: "Too many verification attempts. Please wait 10 minutes.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

export const shopkeeperRouter = Router();

// ─── POST /draft/init ────────────────────────────────────────────────────────
shopkeeperRouter.post(
  "/draft/init",
  async (req: Request, res: Response): Promise<any> => {
    const schema = z.object({
      email: z.string().trim().toLowerCase().email().max(254),
      password: z.string().min(8).max(200),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ message: "Invalid email or password" });

    try {
      const result = await initShopkeeperDraft(
        parsed.data.email,
        parsed.data.password,
      );
      return res.json(result);
    } catch (err: any) {
      console.error("Draft init:", err?.message);
      return res.status(400).json({
        message: safeMessage(
          err,
          "Failed to create account. Please try again.",
        ),
      });
    }
  },
);

// ─── PUT /draft/:draftId ─────────────────────────────────────────────────────
shopkeeperRouter.put(
  "/draft/:draftId",
  async (req: Request, res: Response): Promise<any> => {
    const schema = z.object({
      step: z.number().int().min(1).max(4),
      data: z.record(z.string(), z.unknown()),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ message: "Invalid request" });

    try {
      await updateShopkeeperDraft(
        req.params.draftId as string,
        parsed.data.step,
        parsed.data.data,
      );
      return res.json({ message: "Draft updated" });
    } catch (err: any) {
      console.error("Draft update:", err?.message);
      return res.status(400).json({
        message: safeMessage(err, "Failed to save details. Please try again."),
      });
    }
  },
);

// ─── POST /validate-phone ─────────────────────────────────────────────────────
//
// Standalone endpoint so the frontend can validate a phone number *before*
// committing to step 2 (or in real-time while the user types).
//
// Request:  { phoneNumber: "9876543210" }   (10-digit, no country code)
// Response: 200 { valid: true, lineType: "mobile", carrier: "Jio" }
//           422 { message: "Only mobile numbers are accepted", lineType: "landline" }
//           400 { message: "Invalid Indian mobile number format" }
//
shopkeeperRouter.post(
  "/validate-phone",
  async (req: Request, res: Response): Promise<any> => {
    const schema = z.object({
      phoneNumber: z
        .string()
        .regex(
          /^[6-9]\d{9}$/,
          "Invalid Indian mobile number format — must be 10 digits starting with 6–9",
        ),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({
        message: parsed.error.issues[0]?.message ?? "Invalid phone number",
      });

    try {
      const result = await validatePhoneNumber(parsed.data.phoneNumber);

      if (!result.valid) {
        // 422 Unprocessable Entity — number is structurally OK but not accepted
        return res.status(422).json({
          message: result.error ?? "Invalid phone number",
          lineType: result.lineType,
        });
      }

      return res.json({
        valid: true,
        lineType: result.lineType,
        carrier: result.carrier,
      });
    } catch (err: any) {
      console.error("Phone validate:", err?.message);
      return res
        .status(500)
        .json({ message: "Validation failed, please try again" });
    }
  },
);

// ─── POST /phone/send-otp ─────────────────────────────────────────────────────
// Rate limited: 3 requests per phone per 10 minutes
shopkeeperRouter.post(
  "/phone/send-otp",
  otpSendLimiter,
  async (req: Request, res: Response): Promise<any> => {
    const schema = z.object({
      draftId: z.string().min(1),
      phoneNumber: z
        .string()
        .regex(/^[6-9]\d{9}$/, "Invalid Indian mobile number"),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({
        message: parsed.error.issues[0]?.message ?? "Invalid request",
      });

    try {
      await sendPhoneOtp(parsed.data.draftId, parsed.data.phoneNumber);
      return res.json({ message: "OTP sent" });
    } catch (err: any) {
      console.error("Phone OTP send:", err?.message);
      // VerifyError = known Twilio Verify rejection → 422
      // Validation errors (from phoneValidation.ts) → 422
      // Everything else → 500
      if (err instanceof VerifyError) {
        return res.status(422).json({ message: err.message });
      }
      const isValidationError =
        err?.message === "Invalid phone number" ||
        err?.message === "Virtual/VoIP numbers are not allowed" ||
        err?.message === "Only mobile numbers are accepted";
      return res.status(isValidationError ? 422 : 500).json({
        message: safeMessage(err, "Failed to send OTP. Please try again."),
      });
    }
  },
);

// ─── POST /phone/verify-otp ──────────────────────────────────────────────────
// Rate limited: 10 attempts per draft per 10 minutes
shopkeeperRouter.post(
  "/phone/verify-otp",
  otpVerifyLimiter,
  async (req: Request, res: Response): Promise<any> => {
    const schema = z.object({
      draftId: z.string().min(1),
      code: z.string().length(6),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ message: "Invalid request" });

    try {
      const { phoneVerifiedToken } = await verifyPhoneOtp(
        parsed.data.draftId,
        parsed.data.code,
      );
      return res.json({ message: "Phone verified", token: phoneVerifiedToken });
    } catch (err: any) {
      // VerifyError = wrong code / max-attempts / expired → 422
      if (err instanceof VerifyError) {
        return res.status(422).json({ message: err.message });
      }
      console.error("OTP verify:", err?.message);
      return res.status(400).json({
        message: safeMessage(err, "Verification failed. Please try again."),
      });
    }
  },
);

// ─── POST /payment/create-order ───────────────────────────────────────────────
//
// Step 1 of the Razorpay flow:
//   Backend creates an order with the exact amount → returns orderId, amount, keyId
//   Frontend opens window.Razorpay checkout with these values
//
shopkeeperRouter.post(
  "/payment/create-order",
  async (req: Request, res: Response): Promise<any> => {
    const schema = z.object({
      draftId: z.string().min(1),
      planType: z.enum(["1m", "2m", "3m"]),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ message: "Invalid request" });

    try {
      const result = await createOrder(
        parsed.data.draftId,
        parsed.data.planType,
      );
      return res.json(result);
    } catch (err: any) {
      console.error("Create order:", err?.message);
      return res.status(400).json({
        message: safeMessage(err, "Failed to create order. Please try again."),
      });
    }
  },
);

// ─── POST /payment/verify ─────────────────────────────────────────────────────
//
// Step 2 of the Razorpay flow (SECURITY-CRITICAL):
//   Frontend sends razorpay_order_id + razorpay_payment_id + razorpay_signature
//   Backend re-computes HMAC_SHA256(orderId|paymentId, KEY_SECRET) and compares
//   Only if signatures match → create shopkeeper account
//
// WHY: Without this check, a malicious user could fake a successful payment.
//
shopkeeperRouter.post(
  "/payment/verify",
  async (req: Request, res: Response): Promise<any> => {
    const schema = z.object({
      draftId: z.string().min(1),
      planType: z.enum(["1m", "2m", "3m"]),
      razorpayOrderId: z.string().min(1),
      razorpayPaymentId: z.string().min(1),
      razorpaySignature: z.string().min(1),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ message: "Invalid request" });

    try {
      const registration = await verifyPaymentAndRegister(
        parsed.data.draftId,
        parsed.data.razorpayOrderId,
        parsed.data.razorpayPaymentId,
        parsed.data.razorpaySignature,
        parsed.data.planType,
      );
      return res.json({
        message: "Payment verified. Registration complete.",
        token: signShopkeeperToken(registration.shopkeeperId),
        shopkeeperId: registration.shopkeeperId,
        shopId: registration.shopId,
        roomId: registration.roomId,
        inviteCode: registration.inviteCode,
        inviteLink: registration.inviteLink,
      });
    } catch (err: any) {
      console.error("Payment verify:", err?.message);
      // Signature failures and draft errors → 400
      // Generic server errors → 500
      const isBadRequest =
        err?.message?.includes("signature") ||
        err?.message?.includes("Draft") ||
        err?.message?.includes("not verified") ||
        err?.message?.includes("expired");
      return res.status(isBadRequest ? 400 : 500).json({
        message: safeMessage(
          err,
          "Payment verification failed. Please try again.",
        ),
      });
    }
  },
);

// ─── POST /payment/webhook ────────────────────────────────────────────────────
//
// Razorpay sends events here asynchronously (payment.captured, payment.failed, etc.)
// Register this URL at: razorpay.com → Settings → Webhooks
//
// IMPORTANT: This route reads req.rawBody (set in index.ts via express.raw middleware)
// because the HMAC must be computed on the exact raw bytes Razorpay sent.
//
// Supported events handled here:
//  • payment.captured  — payment succeeded and funds are captured
//  • payment.failed    — payment failed (user declined / insufficient funds)
//
shopkeeperRouter.post(
  "/payment/webhook",
  async (req: Request, res: Response): Promise<any> => {
    const signature = req.headers["x-razorpay-signature"];
    const rawBody = (req as any).rawBody as string | undefined;

    if (typeof signature !== "string" || !rawBody) {
      return res.status(400).json({ message: "Missing signature or body" });
    }

    // Verify webhook authenticity before processing
    if (!verifyWebhookSignature(rawBody, signature)) {
      console.warn("[Webhook] Invalid signature — ignoring event");
      return res.status(401).json({ message: "Invalid webhook signature" });
    }

    let event: { event: string; payload: any };
    try {
      event = JSON.parse(rawBody);
    } catch {
      return res.status(400).json({ message: "Invalid JSON body" });
    }

    const eventType = event?.event;
    const payment = event?.payload?.payment?.entity;

    switch (eventType) {
      case "payment.captured":
        // Payment succeeded — the shopkeeper account is already created by /payment/verify
        // Use this event for: sending confirmation email, analytics, audit logs, etc.
        console.log(
          `[Webhook] payment.captured — paymentId: ${payment?.id}, amount: ₹${(payment?.amount ?? 0) / 100}`,
        );
        break;

      case "payment.failed":
        // Payment failed — log for support
        console.warn(
          `[Webhook] payment.failed — paymentId: ${payment?.id}, reason: ${payment?.error_description}`,
        );
        break;

      default:
        // Acknowledge unknown events to prevent Razorpay from retrying
        console.log(`[Webhook] Unhandled event: ${eventType}`);
    }

    // Always respond 200 so Razorpay doesn't retry
    return res.json({ received: true });
  },
);

// ─── Stripe routes (commented out — replaced by Razorpay) ────────────────────
//
// shopkeeperRouter.post("/payment/create-intent", async (req, res) => { ... });
// shopkeeperRouter.post("/register", async (req, res) => { ... });

// ─── POST /upload-logo ───────────────────────────────────────────────────────
shopkeeperRouter.post(
  "/upload-logo",
  async (req: Request, res: Response): Promise<any> => {
    const schema = z.object({
      draftId: z.string().min(1),
      // Base64 data URI — must be an image MIME type
      image: z
        .string()
        .refine(
          (s) => /^data:image\/(jpeg|jpg|png|webp);base64,/.test(s),
          "Only JPEG, PNG, or WebP images are accepted",
        ),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({
        message: parsed.error.issues[0]?.message ?? "Invalid request",
      });

    try {
      const logoUrl = await uploadLogoToCloudinary(parsed.data.image);

      // Persist the URL in the draft so /payment/verify can pick it up
      await updateShopkeeperDraft(parsed.data.draftId, 2, { logoUrl });

      return res.json({ logoUrl });
    } catch (err: any) {
      console.error("Logo upload:", err?.message);
      return res
        .status(500)
        .json({ message: "Failed to upload logo. Please try again." });
    }
  },
);

// ─── POST /login ──────────────────────────────────────────────────────────────
shopkeeperRouter.post(
  "/login",
  async (req: Request, res: Response): Promise<any> => {
    const schema = z.object({
      email: z.string().trim().toLowerCase().email().max(254),
      password: z.string().min(1).max(200),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ message: "Invalid email or password" });

    try {
      const shopkeeper = await prisma.shopkeeper.findUnique({
        where: { email: parsed.data.email },
      });
      if (!shopkeeper)
        return res.status(401).json({ message: "Invalid email or password" });

      const valid = await bcrypt.compare(
        parsed.data.password,
        shopkeeper.passwordHash,
      );
      if (!valid)
        return res.status(401).json({ message: "Invalid email or password" });

      const token = signShopkeeperToken(shopkeeper.id);
      return res.json({
        token,
        shopkeeperId: shopkeeper.id,
        shopName: shopkeeper.shopName,
      });
    } catch (err: any) {
      console.error("Shopkeeper login:", err?.message);
      return res
        .status(500)
        .json({ message: "Login failed. Please try again." });
    }
  },
);
