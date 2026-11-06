import { prisma } from "../database/prisma.js";
import { logger } from "../lib/logger.js";
import { validatePhoneNumber } from "../lib/phoneValidation.js";
import { sendVerifyOtp, checkVerifyOtp } from "../lib/twilioVerify.js";
import { signPhoneVerifiedToken } from "../lib/jwt.js";
import {
  generateUniqueInviteCode,
  buildInviteLink,
} from "../utils/inviteCode.js";
import type { RegistrationResult } from "../types/index.js";
// import Stripe from "stripe"; // ── commented out: replaced by Razorpay ──
import { Prisma } from "../generated/client.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { RegistrationError } from "../utils/registrationError.js";
import { PLANS, isPlanId, planEndsAt } from "./plans.js";

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
