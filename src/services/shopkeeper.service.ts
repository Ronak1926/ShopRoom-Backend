import { prisma } from "../database/prisma.js";
import { logger } from "../lib/logger.js";
import { validatePhoneNumber } from "../lib/phoneValidation.js";
import { sendVerifyOtp, checkVerifyOtp } from "../lib/twilioVerify.js";
import { signPhoneVerifiedToken } from "../lib/jwt.js";
import {
  createRazorpayOrder,
  fetchOrderSummary,
  verifyPaymentSignature,
} from "../lib/razorpay.js";
import {
  generateUniqueInviteCode,
  buildInviteLink,
} from "../utils/inviteCode.js";
import type { RegistrationResult } from "../types/index.js";
// import Stripe from "stripe"; // ── commented out: replaced by Razorpay ──
import { Prisma } from "../generated/client.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { RegistrationError } from "../utils/registrationError.js";

const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ─── Draft ────────────────────────────────────────────────────────────────────

/** The only parts of a draft a client may ever see — never the password hash. */
function publicDraft(draft: { currentStep: number; data: unknown }) {
  return { currentStep: draft.currentStep, data: draft.data as Record<string, unknown> };
}

export async function initShopkeeperDraft(email: string, password: string) {
  const existing = await prisma.shopkeeperDraft.findUnique({
    where: { email },
  });

  const expiresAt = new Date(Date.now() + DRAFT_TTL_MS);

  if (existing) {
    // Verify the password matches the draft
    const valid = await verifyPassword(password, existing.passwordHash);
    if (!valid)
      throw new RegistrationError(
        "Incorrect password. A draft already exists for this email.",
      );

    // Renew expiry
    const updated = await prisma.shopkeeperDraft.update({
      where: { id: existing.id },
      data: { expiresAt },
    });

    return { draftId: updated.id, restored: true, draft: publicDraft(updated) };
  }

  // New draft — check no completed shopkeeper with this email
  const shopkeeper = await prisma.shopkeeper.findUnique({ where: { email } });
  if (shopkeeper)
    throw new RegistrationError(
      "An account with this email already exists. Please log in.",
    );

  const passwordHash = await hashPassword(password);
  const draft = await prisma.shopkeeperDraft.create({
    data: { email, passwordHash, expiresAt },
  });

  return { draftId: draft.id, restored: false, draft: publicDraft(draft) };
}

/** Throws a user-safe error unless the draft exists and hasn't expired. */
export async function assertDraftActive(draftId: string): Promise<void> {
  const draft = await prisma.shopkeeperDraft.findUnique({
    where: { id: draftId },
    select: { expiresAt: true },
  });
  if (!draft) throw new RegistrationError("Draft not found");
  if (draft.expiresAt < new Date()) throw new RegistrationError("Draft expired");
}

export async function updateShopkeeperDraft(
  draftId: string,
  step: number,
  data: Record<string, unknown>,
) {
  const draft = await prisma.shopkeeperDraft.findUnique({
    where: { id: draftId },
  });
  if (!draft) throw new RegistrationError("Draft not found");
  if (draft.expiresAt < new Date()) throw new RegistrationError("Draft expired");

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
    logger.info("Expired drafts removed", { count });
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
  if (!draft) throw new RegistrationError("Draft not found");

  // Validate phone (Twilio Lookup — currently pass-through; see phoneValidation.ts)
  const validation = await validatePhoneNumber(phoneNumber);
  if (!validation.valid) {
    throw new RegistrationError(validation.error ?? "Invalid phone number");
  }

  if (draft.expiresAt < new Date()) throw new RegistrationError("Draft expired");

  // Store phone number on the draft so verifyPhoneOtp can read it back.
  // Switching numbers voids any earlier verification: the proof was for the old one.
  const existingData = draft.data as Record<string, unknown>;
  const merged = { ...existingData, phoneNumber };
  await prisma.shopkeeperDraft.update({
    where: { id: draftId },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: {
      data: merged as any,
      ...(existingData.phoneNumber !== phoneNumber ? { phoneVerified: false } : {}),
    },
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
  if (!draft) throw new RegistrationError("Draft not found");

  const draftData = draft.data as Record<string, unknown>;
  const phoneNumber = draftData.phoneNumber as string | undefined;
  if (!phoneNumber) throw new RegistrationError("No phone number associated with draft");

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

/** Short identifier stored on the Razorpay order; ties a payment back to its draft. */
export function receiptFor(draftId: string): string {
  return `sk_${draftId.slice(-10)}`;
}

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
  if (!draft) throw new RegistrationError("Draft not found");
  if (draft.expiresAt < new Date()) throw new RegistrationError("Draft expired");
  if (!draft.phoneVerified) throw new RegistrationError("Phone number not verified");

  const amount = PLAN_AMOUNTS[planType];
  if (!amount) throw new RegistrationError("Invalid plan type");

  return createRazorpayOrder(amount, receiptFor(draftId));
}

/** The paid order must be the one created for this draft, at this plan's price. */
export function assertOrderMatchesPlan(
  order: { amount: number | null; receipt: string | null },
  draftId: string,
  planType: string,
): void {
  if (order.receipt !== receiptFor(draftId)) {
    throw new RegistrationError("This payment does not belong to this registration");
  }
  if (order.amount !== null && order.amount !== PLAN_AMOUNTS[planType]) {
    throw new RegistrationError("The amount paid does not match the selected plan");
  }
}

/**
 * Verifies the Razorpay payment signature, then — in a single atomic
 * transaction — creates the Shopkeeper, Shop, and Room records.
 *
 * Transaction steps:
 *  1. Verify HMAC signature (before any DB write)
 *  2. Load & validate draft
 *  3. Create Shopkeeper (auth + plan)
 *  4. Create Shop (business entity)
 *  5. Generate a unique invite code (collision-checked inside the tx)
 *  6. Create Room (linked to shop, invite code set)
 *  7. Delete draft
 *
 * Returns RegistrationResult so the caller can forward shopId / roomId /
 * inviteCode to the frontend in a single response.
 */
export async function verifyPaymentAndRegister(
  draftId: string,
  razorpayOrderId: string,
  razorpayPaymentId: string,
  razorpaySignature: string,
  planType: string,
): Promise<RegistrationResult> {
  // ── 1. Verify signature ──────────────────────────────────────────────────────
  const valid = verifyPaymentSignature(
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
  );
  if (!valid) {
    throw new RegistrationError(
      "Payment verification failed — signature mismatch. Do not retry; contact support.",
    );
  }

  // ── 2. Load draft (outside transaction — fast read) ──────────────────────────
  const draft = await prisma.shopkeeperDraft.findUnique({
    where: { id: draftId },
  });
  if (!draft) throw new RegistrationError("Draft not found");
  if (!draft.phoneVerified) throw new RegistrationError("Phone not verified");
  if (draft.expiresAt < new Date()) throw new RegistrationError("Draft expired");

  // ── 2b. The paid order must be the one WE made for this draft and this plan ──
  // The signature only proves that some order was paid. Without this check a
  // cheap 1-month payment could be presented for a 3-month plan, or a payment
  // made for another registration could be replayed against this one.
  assertOrderMatchesPlan(await fetchOrderSummary(razorpayOrderId), draftId, planType);

  const data = draft.data as Record<string, unknown>;

  // ── 3. Calculate plan expiry ─────────────────────────────────────────────────
  const PLAN_DAYS: Record<string, number> = { "1m": 30, "2m": 60, "3m": 90 };
  const days = PLAN_DAYS[planType] ?? 30;
  const planExpiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  // ── 4–7. Atomic transaction ──────────────────────────────────────────────────
  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      // 4a. Create Shopkeeper (auth + plan metadata)
      const shopkeeper = await tx.shopkeeper.create({
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

      // 4b. Build GeoJSON coordinates (only when both lat and lng are present)
      const lat = (data.latitude as number | null) ?? null;
      const lng = (data.longitude as number | null) ?? null;
      const coordinates =
        lat != null && lng != null
          ? { type: "Point", coordinates: [lng, lat] }
          : undefined;

      // 4c. Create Shop (business entity linked to Shopkeeper)
      const shop = await tx.shop.create({
        data: {
          ownerId: shopkeeper.id,
          shopName: (data.shopName as string) ?? "",
          category: (data.shopCategory as string) ?? "",
          description: (data.description as string) ?? null,
          logoUrl: (data.logoUrl as string) ?? null,
          address: (data.address as string) ?? "",
          city: (data.city as string) ?? "",
          state: (data.state as string) ?? "",
          pincode: (data.pincode as string) ?? "",
          phoneNumber: (data.phoneNumber as string) ?? "",
          latitude: lat,
          longitude: lng,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          coordinates: coordinates as any,
        },
      });

      // 5. Generate a unique invite code (collision-checked inside this tx)
      const inviteCode = await generateUniqueInviteCode(tx);

      // 6. Create Room (auto-created for every shop)
      const room = await tx.room.create({
        data: {
          shopId: shop.id,
          inviteCode,
        },
      });

      // 7. Delete draft — registration is complete
      await tx.shopkeeperDraft.delete({ where: { id: draftId } });

      return { shopkeeper, shop, room };
    });
  } catch (err) {
    // razorpayOrderId / razorpayPaymentId are unique: one payment buys one account.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new RegistrationError("This payment has already been used", 409);
    }
    throw err;
  }

  return {
    shopkeeperId: result.shopkeeper.id,
    shopId: result.shop.id,
    roomId: result.room.id,
    inviteCode: result.room.inviteCode,
    inviteLink: buildInviteLink(result.room.inviteCode),
  };
}

// ─── Stripe (commented out — replaced by Razorpay) ───────────────────────────
//
// export async function createPaymentIntent(draftId: string, planType: string) {
//   const draft = await prisma.shopkeeperDraft.findUnique({ where: { id: draftId } });
//   if (!draft) throw new RegistrationError("Draft not found");
//   if (!draft.phoneVerified) throw new RegistrationError("Phone number not verified");
//   const amount = PLAN_AMOUNTS[planType];
//   if (!amount) throw new RegistrationError("Invalid plan type");
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
