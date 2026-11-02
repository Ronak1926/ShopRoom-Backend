import type { Request, Response } from "express";
import { z } from "zod";
import {
  initShopkeeperDraft,
  updateShopkeeperDraft,
  sendPhoneOtp,
  verifyPhoneOtp,
  createOrder,
  verifyPaymentAndRegister,
  assertDraftActive,
} from "../services/shopkeeper.service.js";
import { uploadLogoToCloudinary } from "../lib/cloudinary.js";
import { validatePhoneNumber } from "../lib/phoneValidation.js";
import { VerifyError } from "../lib/twilioVerify.js";
import { verifyWebhookSignature } from "../lib/razorpay.js";
import { signShopkeeperToken } from "../utils/jwt.js";
import { prisma } from "../database/prisma.js";
import { imageDataUriSchema } from "../schemas/imageUpload.schema.js";
import { newPasswordSchema, needsRehash, hashPassword, verifyPassword } from "../utils/password.js";
import { RegistrationError } from "../utils/registrationError.js";
import { NotificationError } from "../utils/notificationError.js";
import { revokeSessions } from "../services/session.service.js";
import { deleteShopkeeperAccount } from "../services/shopkeeperAccount.service.js";
import { disconnectViewer } from "../realtime/socket.js";
import { logger } from "../lib/logger.js";
import { paymentVerifications, razorpayWebhooks } from "../lib/metrics.js";
import { recordPaymentFailure, recordWebhookFailure } from "../services/alerting.service.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Only errors written to be read by users (RegistrationError, VerifyError,
 * NotificationError) pass their message through. Everything else — Prisma,
 * network, SDK failures — may carry hostnames, SQL or stack details, so the
 * client gets the generic fallback instead.
 */
export function safeMessage(
  err: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  if (
    err instanceof RegistrationError ||
    err instanceof VerifyError ||
    err instanceof NotificationError
  ) {
    return err.message;
  }
  return fallback;
}

// ── Schemas ───────────────────────────────────────────────────────────────────

const draftInitSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: newPasswordSchema,
});

/**
 * The shop details a client may write to its draft. Unknown keys are dropped,
 * so a client can never set the server-managed fields (phoneNumber, which only
 * changes through the OTP flow, and logoUrl, which only comes from our upload).
 */
const draftDataSchema = z
  .object({
    shopName: z.string().trim().min(2).max(120),
    shopCategory: z.string().trim().min(2).max(60),
    address: z.string().trim().min(2).max(200),
    city: z.string().trim().min(2).max(100),
    state: z.string().trim().min(2).max(100),
    pincode: z.string().regex(/^\d{6}$/),
    shopAddress: z.string().trim().max(400),
    description: z.string().trim().max(1000),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  })
  .partial();

const draftIdSchema = z.string().min(1).max(64);

const draftUpdateSchema = z.object({
  step: z.number().int().min(1).max(4),
  data: draftDataSchema,
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
  draftId: draftIdSchema,
  phoneNumber: z.string().regex(/^[6-9]\d{9}$/, "Invalid Indian mobile number"),
});

const verifyOtpSchema = z.object({
  draftId: draftIdSchema,
  code: z.string().length(6),
});

const createOrderSchema = z.object({
  draftId: draftIdSchema,
  planType: z.enum(["1m", "2m", "3m"]),
});

const verifyPaymentSchema = z.object({
  draftId: draftIdSchema,
  planType: z.enum(["1m", "2m", "3m"]),
  razorpayOrderId: z.string().min(1).max(64),
  razorpayPaymentId: z.string().min(1).max(64),
  razorpaySignature: z.string().min(1).max(256),
});

const uploadLogoSchema = z.object({
  draftId: draftIdSchema,
  image: imageDataUriSchema,
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
    logger.error("Draft init", err);
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
  const draftId = draftIdSchema.safeParse(req.params.draftId);
  if (!draftId.success) {
    res.status(400).json({ message: "Invalid request" });
    return;
  }
  try {
    await updateShopkeeperDraft(
      draftId.data,
      parsed.data.step,
      parsed.data.data,
    );
    res.json({ message: "Draft updated" });
  } catch (err) {
    logger.error("Draft update", err);
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
    logger.error("Phone validate", err);
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
    logger.error("Phone OTP send", err);
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
    logger.error("OTP verify", err);
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
    logger.error("Create order", err);
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
    paymentVerifications.inc({ outcome: "success" });
    res.json({
      message: "Payment verified. Registration complete.",
      token: signShopkeeperToken(registration.shopkeeperId, 0),
      shopkeeperId: registration.shopkeeperId,
      shopId: registration.shopId,
      roomId: registration.roomId,
      inviteCode: registration.inviteCode,
      inviteLink: registration.inviteLink,
    });
  } catch (err) {
    paymentVerifications.inc({ outcome: "failure" });
    recordPaymentFailure();
    logger.error("Payment verify", err);
    res
      .status(err instanceof RegistrationError ? err.status : 500)
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
    logger.warn("Razorpay webhook rejected: invalid signature");
    razorpayWebhooks.inc({ result: "invalid_signature" });
    recordWebhookFailure();
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
    razorpayWebhooks.inc({ result: "invalid_body" });
    res.status(400).json({ message: "Invalid JSON body" });
    return;
  }

  const eventType = event?.event;
  const payment = event?.payload?.payment?.entity;

  switch (eventType) {
    case "payment.captured":
      razorpayWebhooks.inc({ result: "captured" });
      logger.info("Razorpay payment captured", { paymentId: payment?.id, amountInr: (payment?.amount ?? 0) / 100 });
      break;
    case "payment.failed":
      razorpayWebhooks.inc({ result: "payment_failed" });
      logger.warn("Razorpay payment failed", { paymentId: payment?.id, reason: payment?.error_description });
      break;
    default:
      razorpayWebhooks.inc({ result: "ignored" });
      logger.info("Razorpay webhook ignored", { eventType });
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
    // Check the draft first so strangers can't use this endpoint as a free image host.
    await assertDraftActive(parsed.data.draftId);
    const logoUrl = await uploadLogoToCloudinary(parsed.data.image);
    await updateShopkeeperDraft(parsed.data.draftId, 2, { logoUrl });
    res.json({ logoUrl });
  } catch (err) {
    logger.error("Logo upload", err);
    res
      .status(err instanceof RegistrationError ? err.status : 500)
      .json({ message: safeMessage(err, "Failed to upload logo. Please try again.") });
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
      select: { id: true, shopName: true, passwordHash: true, tokenVersion: true },
    });
    // Compares even when the email is unknown, so timing doesn't reveal which emails exist.
    const valid = await verifyPassword(parsed.data.password, shopkeeper?.passwordHash);
    if (!shopkeeper || !valid) {
      res.status(401).json({ message: "Invalid email or password" });
      return;
    }
    if (needsRehash(shopkeeper.passwordHash)) {
      // Best effort: failing to upgrade the hash must not fail the login.
      await hashPassword(parsed.data.password)
        .then((passwordHash) =>
          prisma.shopkeeper.update({ where: { id: shopkeeper.id }, data: { passwordHash } }),
        )
        .catch(() => undefined);
    }
    res.json({
      token: signShopkeeperToken(shopkeeper.id, shopkeeper.tokenVersion),
      shopkeeperId: shopkeeper.id,
      shopName: shopkeeper.shopName,
    });
  } catch (err) {
    logger.error("Shopkeeper login", err);
    res.status(500).json({ message: "Login failed. Please try again." });
  }
}

// ── POST /api/shopkeeper/logout-all ───────────────────────────────────────────
// Invalidates every session of the account, including the one making the call.

export async function logoutAllShopkeeperHandler(req: Request, res: Response): Promise<void> {
  await revokeSessions("shopkeeper", req.shopkeeperId!);
  disconnectViewer(`SK:${req.shopkeeperId}`);
  res.json({ message: "Signed out everywhere" });
}

// ── DELETE /api/shopkeeper/me ─────────────────────────────────────────────────
// Permanently deletes the shopkeeper, their shop and room, and all of their
// notification data. Requires the account password again.

const deleteAccountSchema = z.object({ password: z.string().min(1).max(200) });

export async function deleteShopkeeperAccountHandler(req: Request, res: Response): Promise<void> {
  const shopkeeperId = req.shopkeeperId!;
  const parsed = deleteAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Password is required" });
    return;
  }

  try {
    const shopkeeper = await prisma.shopkeeper.findUnique({
      where: { id: shopkeeperId },
      select: { passwordHash: true },
    });
    const confirmed = await verifyPassword(parsed.data.password, shopkeeper?.passwordHash);
    if (!shopkeeper || !confirmed) {
      res.status(403).json({ message: "Could not confirm your identity" });
      return;
    }

    await deleteShopkeeperAccount(shopkeeperId);
    disconnectViewer(`SK:${shopkeeperId}`);
    res.json({ message: "Your account has been deleted" });
  } catch (err) {
    logger.error("Shopkeeper delete", err);
    res.status(500).json({ message: "Could not delete the account. Please try again." });
  }
}
