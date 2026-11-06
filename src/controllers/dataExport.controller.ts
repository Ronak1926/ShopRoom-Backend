/**
 * controllers/dataExport.controller.ts — "Download my data" for customers and shopkeepers.
 *
 * It is a POST that asks for the password (or a fresh Google sign-in) again: the file holds the
 * account's private messages and details, so a stolen session alone must not be enough to take it.
 * The proof travels in the body, never in a URL.
 */

import type { Request, Response } from "express";
import z from "zod";
import { logger } from "../lib/logger.js";
import { exportCustomerData, exportShopkeeperData } from "../services/dataExport.service.js";
import { confirmCustomerIdentity, confirmShopkeeperIdentity, type Reauthentication } from "../services/reauth.service.js";
import { parseBody } from "../utils/validate.js";

const customerProofSchema = z.object({
  password: z.string().min(1).max(200).optional(),
  idToken: z.string().min(10).max(4096).optional(),
});
const shopkeeperProofSchema = z.object({ password: z.string().min(1).max(200) });

function sendAsDownload(res: Response, kind: "customer" | "shopkeeper", data: unknown): void {
  const day = new Date().toISOString().slice(0, 10);
  res.set({
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="shoproom-${kind}-data-${day}.json"`,
    // Personal data: never kept by a browser cache or a shared proxy.
    "Cache-Control": "no-store",
  });
  res.send(JSON.stringify(data, null, 2));
}

/** Maps a failed proof to the response; returns true when the caller may go on. */
function proceedOrRespond(res: Response, proof: Reauthentication, notFound: string): boolean {
  if (proof === "confirmed") return true;
  if (proof === "not-found") res.status(404).json({ message: notFound });
  else res.status(403).json({ message: "Could not confirm your identity" });
  return false;
}

// POST /api/customers/me/export
export async function exportCustomerDataHandler(req: Request, res: Response): Promise<void> {
  const customerId = req.customerId!;
  const parsed = parseBody(req, customerProofSchema);
  if (!parsed.ok) {
    res.status(400).json({ message: "Enter your password to continue" });
    return;
  }
  try {
    if (!proceedOrRespond(res, await confirmCustomerIdentity(customerId, parsed.data), "Customer not found")) return;
    const data = await exportCustomerData(customerId);
    if (!data) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }
    sendAsDownload(res, "customer", data);
  } catch (err) {
    logger.error("Customer data export", err);
    res.status(500).json({ message: "Could not prepare your data. Please try again." });
  }
}

// POST /api/shopkeeper/me/export
export async function exportShopkeeperDataHandler(req: Request, res: Response): Promise<void> {
  const shopkeeperId = req.shopkeeperId!;
  const parsed = shopkeeperProofSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Enter your password to continue" });
    return;
  }
  try {
    if (!proceedOrRespond(res, await confirmShopkeeperIdentity(shopkeeperId, parsed.data.password), "Shopkeeper not found")) return;
    const data = await exportShopkeeperData(shopkeeperId);
    if (!data) {
      res.status(404).json({ message: "Shopkeeper not found" });
      return;
    }
    sendAsDownload(res, "shopkeeper", data);
  } catch (err) {
    logger.error("Shopkeeper data export", err);
    res.status(500).json({ message: "Could not prepare your data. Please try again." });
  }
}
