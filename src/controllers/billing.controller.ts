/**
 * controllers/billing.controller.ts — A signed-in shopkeeper's plan: view it,
 * start a renewal payment, and confirm it. The payment checks live in
 * services/billing.service.ts.
 */

import type { Request, Response } from "express";
import z from "zod";
import { createRenewalOrder, getBilling, verifyRenewal } from "../services/billing.service.js";
import { handleControllerError } from "./notificationResponse.js";

const orderSchema = z.object({ planType: z.enum(["1m", "2m", "3m"]) });

const verifySchema = z.object({
  planType: z.enum(["1m", "2m", "3m"]),
  razorpayOrderId: z.string().min(1).max(64),
  razorpayPaymentId: z.string().min(1).max(64),
  razorpaySignature: z.string().min(1).max(256),
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
    handleControllerError(res, err, "Failed to start the payment");
  }
}

// POST /api/shopkeeper/billing/verify  { planType, razorpayOrderId, razorpayPaymentId, razorpaySignature }
export async function verifyRenewalHandler(req: Request, res: Response): Promise<void> {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid payment details" });
    return;
  }
  try {
    res.json({ data: await verifyRenewal(req.shopkeeperId!, parsed.data), message: "Plan renewed" });
  } catch (err) {
    handleControllerError(res, err, "Payment verification failed. Please try again.");
  }
}
