/**
 * controllers/billing.controller.ts — A signed-in shopkeeper's plan: view it,
 * start a renewal payment, and confirm it. The payment itself is handled by the
 * payment services (see payment.controller.ts for the first payment).
 */

import type { Request, Response } from "express";
import z from "zod";
import { getBilling, verifyRenewal } from "../services/billing.service.js";
import { createRenewalOrder } from "../services/paymentOrder.service.js";
import { handleControllerError } from "./notificationResponse.js";
import { respondWithPaymentFailure } from "./payment.controller.js";

const orderSchema = z.object({ planType: z.enum(["1m", "2m", "3m"]) });

const razorpayId = z.string().regex(/^[A-Za-z0-9_]{1,64}$/);

const verifySchema = z.object({
  razorpayOrderId: razorpayId,
  razorpayPaymentId: razorpayId,
  razorpaySignature: z.string().min(1).max(128),
});

// GET /api/shopkeeper/billing
export async function getBillingHandler(req: Request, res: Response): Promise<void> {
  try {
    res.json({ data: await getBilling(req.shopkeeperId!) });
  } catch (err) {
    handleControllerError(res, err, "Failed to load billing");
  }
}

// POST /api/shopkeeper/billing/order  { planType }
export async function createRenewalOrderHandler(req: Request, res: Response): Promise<void> {
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Choose a plan" });
    return;
  }
  try {
    res.json({ data: await createRenewalOrder(req.shopkeeperId!, parsed.data.planType) });
  } catch (err) {
    respondWithPaymentFailure(res, err, "Renewal order", "Could not start the payment. Please try again.");
  }
}

// POST /api/shopkeeper/billing/verify  { razorpayOrderId, razorpayPaymentId, razorpaySignature }
export async function verifyRenewalHandler(req: Request, res: Response): Promise<void> {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payment details" });
    return;
  }
  try {
    res.json({ data: await verifyRenewal(req.shopkeeperId!, parsed.data), message: "Plan renewed" });
  } catch (err) {
    respondWithPaymentFailure(res, err, "Renewal verify", "We could not confirm your payment. Please try again; if money was taken, do not pay again.");
  }
}
