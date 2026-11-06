/**
 * controllers/invoice.controller.ts — GST tax invoices for a signed-in shopkeeper's own payments,
 * and the GSTIN they want printed on them.
 */

import type { Request, Response } from "express";
import z from "zod";
import { getInvoice, setBuyerGstin } from "../services/invoice.service.js";
import { handleControllerError } from "./notificationResponse.js";

const paymentId = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const gstinSchema = z.object({ gstin: z.string().trim().max(15).nullable() });

// GET /api/shopkeeper/billing/invoices/:paymentId
export async function getInvoiceHandler(req: Request, res: Response): Promise<void> {
  const id = paymentId.safeParse(req.params.paymentId);
  if (!id.success) {
    res.status(404).json({ message: "Invoice not found" });
    return;
  }
  try {
    const result = await getInvoice(req.shopkeeperId!, id.data);
    if (result.status === "disabled") {
      res.status(404).json({ message: "Tax invoices are not available yet." });
      return;
    }
    if (result.status === "not-found") {
      res.status(404).json({ message: "Invoice not found" });
      return;
    }
    res.json({ data: result.invoice });
  } catch (err) {
    handleControllerError(res, err, "Could not prepare the invoice");
  }
}

// PUT /api/shopkeeper/billing/gstin   { gstin: "27AAPFU0939F1ZV" | null }
export async function setGstinHandler(req: Request, res: Response): Promise<void> {
  const parsed = gstinSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Enter a valid 15-character GSTIN, or leave it empty." });
    return;
  }
  try {
    if (!(await setBuyerGstin(req.shopkeeperId!, parsed.data.gstin || null))) {
      res.status(400).json({ message: "That doesn't look like a valid GSTIN. Check the 15 characters and try again." });
      return;
    }
    res.json({ message: "Saved. It will be printed on invoices issued from now on." });
  } catch (err) {
    handleControllerError(res, err, "Could not save the GSTIN");
  }
}
