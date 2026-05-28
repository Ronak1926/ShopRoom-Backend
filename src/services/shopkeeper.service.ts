import { prisma } from "../database/prisma.js";
import { validatePhoneNumber } from "../lib/phoneValidation.js";
import { sendVerifyOtp, checkVerifyOtp } from "../lib/twilioVerify.js";
import { signPhoneVerifiedToken } from "../lib/jwt.js";
import {
  createRazorpayOrder,
  verifyPaymentSignature,
} from "../lib/razorpay.js";
// import Stripe from "stripe"; // ── commented out: replaced by Razorpay ──
import bcrypt from "bcrypt";

const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ─── Draft ────────────────────────────────────────────────────────────────────

export async function initShopkeeperDraft(email: string, password: string) {
  const existing = await prisma.shopkeeperDraft.findUnique({
    where: { email },
  });

  const expiresAt = new Date(Date.now() + DRAFT_TTL_MS);

  if (existing) {
    // Verify the password matches the draft
    const valid = await bcrypt.compare(password, existing.passwordHash);
    if (!valid)
      throw new Error(
        "Incorrect password. A draft already exists for this email.",
      );

    // Renew expiry
    const updated = await prisma.shopkeeperDraft.update({
      where: { id: existing.id },
      data: { expiresAt },
    });

    return { draftId: updated.id, restored: true, draft: updated };
  }

  // New draft — check no completed shopkeeper with this email
  const shopkeeper = await prisma.shopkeeper.findUnique({ where: { email } });
  if (shopkeeper)
    throw new Error(
      "An account with this email already exists. Please log in.",
    );

  const passwordHash = await bcrypt.hash(password, 12);
  const draft = await prisma.shopkeeperDraft.create({
    data: { email, passwordHash, expiresAt },
  });

  return { draftId: draft.id, restored: false, draft };
}

export async function updateShopkeeperDraft(
  draftId: string,
  step: number,
  data: Record<string, unknown>,
) {
  const draft = await prisma.shopkeeperDraft.findUnique({
    where: { id: draftId },
  });
  if (!draft) throw new Error("Draft not found");
  if (draft.expiresAt < new Date()) throw new Error("Draft expired");

  const merged = { ...(draft.data as Record<string, unknown>), ...data };

  await prisma.shopkeeperDraft.update({
    where: { id: draftId },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: { currentStep: step, data: merged as any },
  });
}

/** Remove drafts that passed their 7-day TTL. Call once on server startup. */
export async function cleanupExpiredDrafts() {
  const { count } = await prisma.shopkeeperDraft.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  if (count > 0)
    console.log(`[draft cleanup] removed ${count} expired draft(s)`);
}

// ─── Phone OTP (Twilio Verify) ────────────────────────────────────────────────

/**
 * Triggers a Twilio Verify OTP delivery to `phoneNumber`.
 *
 * Twilio Verify manages OTP generation, storage, expiry, and retry limits
 * internally — no PhoneOtp records are written to our database.
 */
export async function sendPhoneOtp(draftId: string, phoneNumber: string) {
  const draft = await prisma.shopkeeperDraft.findUnique({
    where: { id: draftId },
  });
  if (!draft) throw new Error("Draft not found");

  // Validate phone (Twilio Lookup — currently pass-through; see phoneValidation.ts)
  const validation = await validatePhoneNumber(phoneNumber);
  if (!validation.valid) {
    throw new Error(validation.error ?? "Invalid phone number");
  }

  // Store phone number on the draft so verifyPhoneOtp can read it back
  const merged = {
    ...(draft.data as Record<string, unknown>),
    phoneNumber,
  };
  await prisma.shopkeeperDraft.update({
    where: { id: draftId },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: { data: merged as any },
  });

  // Delegate OTP send to Twilio Verify (throws VerifyError on failure)
  await sendVerifyOtp(phoneNumber);
}

/**
 * Checks the OTP code via Twilio Verify.
 *
 * On success:
 *  • Marks the draft as phoneVerified and advances to step 4
 *  • Returns a short-lived JWT ("phone verified token") the frontend
 *    can pass along with subsequent requests as proof of phone ownership
 *
 * Throws a VerifyError (translated to 422 by the route handler) for
 * wrong code / max-attempts / expired scenarios.
 */
export async function verifyPhoneOtp(
  draftId: string,
  code: string,
): Promise<{ phoneVerifiedToken: string }> {
  const draft = await prisma.shopkeeperDraft.findUnique({
    where: { id: draftId },
  });
  if (!draft) throw new Error("Draft not found");

  const draftData = draft.data as Record<string, unknown>;
  const phoneNumber = draftData.phoneNumber as string | undefined;
  if (!phoneNumber) throw new Error("No phone number associated with draft");

  // Throws VerifyError on failure — caller (route) catches and returns 422
  await checkVerifyOtp(phoneNumber, code);

  // OTP approved — mark draft verified and advance step
  await prisma.shopkeeperDraft.update({
    where: { id: draftId },
    data: { phoneVerified: true, currentStep: 4 },
  });

  // Issue short-lived JWT as proof of phone verification
  const phoneVerifiedToken = signPhoneVerifiedToken(draftId, phoneNumber);
  return { phoneVerifiedToken };
}

// ─── Payment (Razorpay) ───────────────────────────────────────────────────────

const PLAN_AMOUNTS: Record<string, number> = {
  "1m": 39900, // ₹399 in paise
  "2m": 59900, // ₹599
  "3m": 89900, // ₹899
};

/**
 * Creates a Razorpay order for the selected plan.
 *
 * Flow:
 *  1. Verify draft exists and phone is verified
 *  2. Create order via Razorpay API (amount, currency, receipt)
 *  3. Return orderId + amount + keyId to frontend
 *  4. Frontend opens Razorpay checkout with these values
 */
export async function createOrder(draftId: string, planType: string) {
  const draft = await prisma.shopkeeperDraft.findUnique({
    where: { id: draftId },
  });
  if (!draft) throw new Error("Draft not found");
  if (!draft.phoneVerified) throw new Error("Phone number not verified");

  const amount = PLAN_AMOUNTS[planType];
  if (!amount) throw new Error("Invalid plan type");

  // receipt is a short identifier for your records; not shown to the user
  const receipt = `sk_${draftId.slice(-10)}`;
  return createRazorpayOrder(amount, receipt);
}

/**
 * Verifies the Razorpay payment signature, then creates the shopkeeper account.
 *
 * This is the critical security step:
 *  • Signature = HMAC_SHA256(orderId + "|" + paymentId, KEY_SECRET)
 *  • If invalid → reject immediately (possible tampering)
 *  • If valid   → register shopkeeper and clean up draft
 */
export async function verifyPaymentAndRegister(
  draftId: string,
  razorpayOrderId: string,
  razorpayPaymentId: string,
  razorpaySignature: string,
  planType: string,
) {
  // ── 1. Verify signature ──────────────────────────────────────────────────────
  const valid = verifyPaymentSignature(
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
  );
  if (!valid) {
    throw new Error(
      "Payment verification failed — signature mismatch. Do not retry; contact support.",
    );
  }

  // ── 2. Load draft ────────────────────────────────────────────────────────────
  const draft = await prisma.shopkeeperDraft.findUnique({
    where: { id: draftId },
  });
  if (!draft) throw new Error("Draft not found");
  if (!draft.phoneVerified) throw new Error("Phone not verified");
  if (draft.expiresAt < new Date()) throw new Error("Draft expired");

  const data = draft.data as Record<string, unknown>;

  // ── 3. Calculate plan expiry ─────────────────────────────────────────────────
  const PLAN_DAYS: Record<string, number> = { "1m": 30, "2m": 60, "3m": 90 };
  const days = PLAN_DAYS[planType] ?? 30;
  const planExpiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  // ── 4. Create Shopkeeper record ──────────────────────────────────────────────
  const shopkeeper = await prisma.shopkeeper.create({
    data: {
      email: draft.email,
      passwordHash: draft.passwordHash,
      shopName: (data.shopName as string) ?? "",
      shopCategory: (data.shopCategory as string) ?? "",
      address: (data.address as string) ?? "",
      city: (data.city as string) ?? "",
      state: (data.state as string) ?? "",
      pincode: (data.pincode as string) ?? "",
      latitude: (data.latitude as number) ?? null,
      longitude: (data.longitude as number) ?? null,
      phoneNumber: (data.phoneNumber as string) ?? "",
      logoUrl: (data.logoUrl as string) ?? null,
      planType,
      planExpiresAt,
      razorpayOrderId,
      razorpayPaymentId,
    },
  });

  // ── 5. Clean up draft ────────────────────────────────────────────────────────
  await prisma.shopkeeperDraft.delete({ where: { id: draftId } });

  return shopkeeper;
}

// ─── Stripe (commented out — replaced by Razorpay) ───────────────────────────
//
// export async function createPaymentIntent(draftId: string, planType: string) {
//   const draft = await prisma.shopkeeperDraft.findUnique({ where: { id: draftId } });
//   if (!draft) throw new Error("Draft not found");
//   if (!draft.phoneVerified) throw new Error("Phone number not verified");
//   const amount = PLAN_AMOUNTS[planType];
//   if (!amount) throw new Error("Invalid plan type");
//   const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
//   if (!stripeSecretKey) {
//     console.warn(`⚠️  [Payment — no Stripe key] Plan: ${planType}, Amount: ₹${amount / 100}`);
//     const mockId = `pi_mock_${draftId.slice(-8)}_${Date.now()}`;
//     return { paymentIntentId: mockId, clientSecret: `${mockId}_secret_mock` };
//   }
//   const stripe = new Stripe(stripeSecretKey);
//   const intent = await stripe.paymentIntents.create({
//     amount, currency: "inr",
//     automatic_payment_methods: { enabled: true },
//     metadata: { draftId, planType },
//   });
//   return { paymentIntentId: intent.id, clientSecret: intent.client_secret! };
// }
//
// export async function completeShopkeeperRegistration(
//   draftId: string, stripePaymentIntentId: string, planType: string,
// ) { ... }
