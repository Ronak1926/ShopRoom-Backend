/**
 * config/invoice.ts — Who is issuing GST invoices, and at what rate.
 *
 * The business owner supplies these; the code assumes none of them. Tax invoices stay switched off
 * until every setting is present and valid, so a half-filled configuration can never produce an
 * invoice with a wrong GSTIN or rate. Have an accountant confirm the values.
 */

import { isValidGstin, stateCodeOfGstin } from "../utils/gst.js";

type Env = Record<string, string | undefined>;

export interface InvoiceSeller {
  name: string;
  gstin: string;
  address: string;
  /** The seller's GST state code, taken from the GSTIN. */
  stateCode: string;
  /** Services Accounting Code printed on the invoice. */
  sac: string;
  /** GST rate in percent; the prices customers see are treated as inclusive of it. */
  ratePercent: number;
  /** Start of every invoice number. */
  prefix: string;
}

const SETTINGS = ["INVOICE_SELLER_NAME", "INVOICE_SELLER_GSTIN", "INVOICE_SELLER_ADDRESS", "INVOICE_SAC", "INVOICE_GST_RATE"] as const;

/** The seller, or null when invoicing is not (fully and correctly) configured. */
export function invoiceSeller(env: Env = process.env): InvoiceSeller | null {
  const name = env.INVOICE_SELLER_NAME?.trim();
  const gstin = env.INVOICE_SELLER_GSTIN?.trim().toUpperCase();
  const address = env.INVOICE_SELLER_ADDRESS?.trim();
  const sac = env.INVOICE_SAC?.trim();
  const rate = env.INVOICE_GST_RATE?.trim();
  const prefix = env.INVOICE_PREFIX?.trim() || "SR";

  if (!name || !gstin || !address || !sac || !rate) return null;
  if (!isValidGstin(gstin)) return null;
  if (!/^\d{4,8}$/.test(sac)) return null;
  const ratePercent = Number(rate);
  if (!(ratePercent >= 0 && ratePercent <= 100)) return null;
  if (!/^[A-Z0-9]{1,8}$/.test(prefix)) return null;

  return { name, gstin, address, stateCode: stateCodeOfGstin(gstin), sac, ratePercent, prefix };
}

/** Some invoice settings are filled in but together they do not make a valid configuration. */
export function invoiceConfigIsPartial(env: Env = process.env): boolean {
  const anySet = SETTINGS.some((name) => env[name]?.trim());
  return anySet && invoiceSeller(env) === null;
}
