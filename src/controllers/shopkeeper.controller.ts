import type { Request, Response } from "express";
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
import { signShopkeeperToken } from "../utils/jwt.js";
import { prisma } from "../database/prisma.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Prevents raw Prisma / DB error details from leaking to the client.
 * Prisma errors carry a name like "PrismaClientValidationError" or a P-code.
 */
function safeMessage(
  err: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  const e = err as { name?: string; code?: string; message?: string };
  if (typeof e?.name === "string" && e.name.startsWith("PrismaClient"))
    return fallback;
  if (typeof e?.code === "string" && /^P\d{4}$/.test(e.code)) return fallback;
  return e?.message ?? fallback;
}

// ── Schemas ───────────────────────────────────────────────────────────────────

const draftInitSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(200),
});

const draftUpdateSchema = z.object({
  step: z.number().int().min(1).max(4),
  data: z.record(z.string(), z.unknown()),
});

const phoneSchema = z.object({
  phoneNumber: z
    .string()
    .regex(
      /^[6-9]\d{9}$/,
      "Invalid Indian mobile number format — must be 10 digits starting with 6–9",
    ),
});

const sendOtpSchema = z.object({
  draftId: z.string().min(1),
  phoneNumber: z.string().regex(/^[6-9]\d{9}$/, "Invalid Indian mobile number"),
});

const verifyOtpSchema = z.object({
  draftId: z.string().min(1),
  code: z.string().length(6),
});

const createOrderSchema = z.object({
  draftId: z.string().min(1),
  planType: z.enum(["1m", "2m", "3m"]),
});

const verifyPaymentSchema = z.object({
  draftId: z.string().min(1),
  planType: z.enum(["1m", "2m", "3m"]),
  razorpayOrderId: z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1),
});

const uploadLogoSchema = z.object({
  draftId: z.string().min(1),
  image: z
    .string()
    .refine(
      (s) => /^data:image\/(jpeg|jpg|png|webp);base64,/.test(s),
      "Only JPEG, PNG, or WebP images are accepted",
    ),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});

// ── Handlers ──────────────────────────────────────────────────────────────────

export async function initDraft(req: Request, res: Response): Promise<void> {
  const parsed = draftInitSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid email or password" });
    return;
  }
  try {
    const result = await initShopkeeperDraft(
      parsed.data.email,
      parsed.data.password,
    );
    res.json(result);
  } catch (err) {
    console.error("Draft init:", (err as Error)?.message);
    res
      .status(400)
      .json({
        message: safeMessage(
          err,
          "Failed to create account. Please try again.",
        ),
      });
  }
}

export async function updateDraft(req: Request, res: Response): Promise<void> {
  const parsed = draftUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid request" });
    return;
  }
  try {
    await updateShopkeeperDraft(
      req.params.draftId as string,
      parsed.data.step,
      parsed.data.data,
    );
    res.json({ message: "Draft updated" });
  } catch (err) {
    console.error("Draft update:", (err as Error)?.message);
    res
      .status(400)
      .json({
        message: safeMessage(err, "Failed to save details. Please try again."),
      });
  }
}

export async function validatePhone(
  req: Request,
  res: Response,
): Promise<void> {
  const parsed = phoneSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: parsed.error.issues[0]?.message ?? "Invalid phone number",
    });
    return;
  }
  try {
    const result = await validatePhoneNumber(parsed.data.phoneNumber);
    if (!result.valid) {
      res.status(422).json({
        message: result.error ?? "Invalid phone number",
        lineType: result.lineType,
      });
      return;
    }
    res.json({
      valid: true,
      lineType: result.lineType,
      carrier: result.carrier,
    });
  } catch (err) {
    console.error("Phone validate:", (err as Error)?.message);
    res.status(500).json({ message: "Validation failed, please try again" });
  }
}

export async function sendPhoneOtpHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const parsed = sendOtpSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: parsed.error.issues[0]?.message ?? "Invalid request",
    });
    return;
  }
  try {
    await sendPhoneOtp(parsed.data.draftId, parsed.data.phoneNumber);
    res.json({ message: "OTP sent" });
  } catch (err) {
    console.error("Phone OTP send:", (err as Error)?.message);
    if (err instanceof VerifyError) {
      res.status(422).json({ message: err.message });
      return;
    }
    const e = err as Error;
    const isValidation =
      e?.message === "Invalid phone number" ||
      e?.message === "Virtual/VoIP numbers are not allowed" ||
      e?.message === "Only mobile numbers are accepted";
    res
      .status(isValidation ? 422 : 500)
      .json({
        message: safeMessage(err, "Failed to send OTP. Please try again."),
      });
  }
}

export async function verifyPhoneOtpHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const parsed = verifyOtpSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid request" });
    return;
  }
  try {
    const { phoneVerifiedToken } = await verifyPhoneOtp(
      parsed.data.draftId,
      parsed.data.code,
    );
    res.json({ message: "Phone verified", token: phoneVerifiedToken });
  } catch (err) {
    if (err instanceof VerifyError) {
      res.status(422).json({ message: err.message });
      return;
    }
    console.error("OTP verify:", (err as Error)?.message);
    res
      .status(400)
      .json({
        message: safeMessage(err, "Verification failed. Please try again."),
      });
  }
}

export async function createPaymentOrder(
  req: Request,
  res: Response,
): Promise<void> {
  const parsed = createOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid request" });
    return;
  }
  try {
    const result = await createOrder(parsed.data.draftId, parsed.data.planType);
    res.json(result);
  } catch (err) {
    console.error("Create order:", (err as Error)?.message);
    res
      .status(400)
      .json({
        message: safeMessage(err, "Failed to create order. Please try again."),
      });
  }
}

export async function verifyPayment(
  req: Request,
  res: Response,
): Promise<void> {
  const parsed = verifyPaymentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid request" });
    return;
  }
  try {
    const registration = await verifyPaymentAndRegister(
      parsed.data.draftId,
      parsed.data.razorpayOrderId,
      parsed.data.razorpayPaymentId,
      parsed.data.razorpaySignature,
      parsed.data.planType,
    );
    res.json({
      message: "Payment verified. Registration complete.",
      token: signShopkeeperToken(registration.shopkeeperId),
      shopkeeperId: registration.shopkeeperId,
      shopId: registration.shopId,
      roomId: registration.roomId,
      inviteCode: registration.inviteCode,
      inviteLink: registration.inviteLink,
    });
  } catch (err) {
    console.error("Payment verify:", (err as Error)?.message);
    const e = err as Error;
    const isBadRequest =
      e?.message?.includes("signature") ||
      e?.message?.includes("Draft") ||
      e?.message?.includes("not verified") ||
      e?.message?.includes("expired");
    res
      .status(isBadRequest ? 400 : 500)
      .json({
        message: safeMessage(
          err,
          "Payment verification failed. Please try again.",
        ),
      });
  }
}

export async function handleWebhook(
  req: Request,
  res: Response,
): Promise<void> {
  const signature = req.headers["x-razorpay-signature"];
  const rawBody = (req as Request & { rawBody?: string }).rawBody;

  if (typeof signature !== "string" || !rawBody) {
    res.status(400).json({ message: "Missing signature or body" });
    return;
  }

  if (!verifyWebhookSignature(rawBody, signature)) {
    console.warn("[Webhook] Invalid signature — ignoring event");
    res.status(401).json({ message: "Invalid webhook signature" });
    return;
  }

  let event: {
    event: string;
    payload: {
      payment?: {
        entity?: { id?: string; amount?: number; error_description?: string };
      };
    };
  };
  try {
    event = JSON.parse(rawBody);
  } catch {
    res.status(400).json({ message: "Invalid JSON body" });
    return;
  }

  const eventType = event?.event;
  const payment = event?.payload?.payment?.entity;

  switch (eventType) {
    case "payment.captured":
      console.log(
        `[Webhook] payment.captured — paymentId: ${payment?.id}, amount: ₹${(payment?.amount ?? 0) / 100}`,
      );
      break;
    case "payment.failed":
      console.warn(
        `[Webhook] payment.failed — paymentId: ${payment?.id}, reason: ${payment?.error_description}`,
      );
      break;
    default:
      console.log(`[Webhook] Unhandled event: ${eventType}`);
  }

  res.json({ received: true });
}

export async function uploadLogo(req: Request, res: Response): Promise<void> {
  const parsed = uploadLogoSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: parsed.error.issues[0]?.message ?? "Invalid request",
    });
    return;
  }
  try {
    const logoUrl = await uploadLogoToCloudinary(parsed.data.image);
    await updateShopkeeperDraft(parsed.data.draftId, 2, { logoUrl });
    res.json({ logoUrl });
  } catch (err) {
    console.error("Logo upload:", (err as Error)?.message);
    res
      .status(500)
      .json({ message: "Failed to upload logo. Please try again." });
  }
}

export async function loginShopkeeper(
  req: Request,
  res: Response,
): Promise<void> {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid email or password" });
    return;
  }
  try {
    const shopkeeper = await prisma.shopkeeper.findUnique({
      where: { email: parsed.data.email },
    });
    if (!shopkeeper) {
      res.status(401).json({ message: "Invalid email or password" });
      return;
    }
    const valid = await bcrypt.compare(
      parsed.data.password,
      shopkeeper.passwordHash,
    );
    if (!valid) {
      res.status(401).json({ message: "Invalid email or password" });
      return;
    }
    res.json({
      token: signShopkeeperToken(shopkeeper.id),
      shopkeeperId: shopkeeper.id,
      shopName: shopkeeper.shopName,
    });
  } catch (err) {
    console.error("Shopkeeper login:", (err as Error)?.message);
    res.status(500).json({ message: "Login failed. Please try again." });
  }
}
