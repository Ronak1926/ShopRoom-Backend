/**
 * utils/gst.ts — The arithmetic and rules behind a GST tax invoice, as pure functions.
 *
 * Nothing here decides what the tax rate or classification is: those come from configuration the
 * business owner supplies (see `config/invoice.ts`). This file only does the sums and the lookups
 * that are the same for everyone: splitting a GST-inclusive price, the financial year, the GSTIN
 * format and its check character, and which state code a name belongs to.
 */

/** Official GST state and union territory codes, by the name people write. */
const STATE_CODES: Record<string, string> = {
  "jammu and kashmir": "01",
  "himachal pradesh": "02",
  punjab: "03",
  chandigarh: "04",
  uttarakhand: "05",
  haryana: "06",
  delhi: "07",
  rajasthan: "08",
  "uttar pradesh": "09",
  bihar: "10",
  sikkim: "11",
  "arunachal pradesh": "12",
  nagaland: "13",
  manipur: "14",
  mizoram: "15",
  tripura: "16",
  meghalaya: "17",
  assam: "18",
  "west bengal": "19",
  jharkhand: "20",
  odisha: "21",
  chhattisgarh: "22",
  "madhya pradesh": "23",
  gujarat: "24",
  "dadra and nagar haveli and daman and diu": "26",
  maharashtra: "27",
  karnataka: "29",
  goa: "30",
  lakshadweep: "31",
  kerala: "32",
  "tamil nadu": "33",
  puducherry: "34",
  "andaman and nicobar islands": "35",
  telangana: "36",
  "andhra pradesh": "37",
  ladakh: "38",
};

const STATE_ALIASES: Record<string, string> = {
  orissa: "odisha",
  pondicherry: "puducherry",
  "nct of delhi": "delhi",
  "new delhi": "delhi",
  uttaranchal: "uttarakhand",
  "j&k": "jammu and kashmir",
  "dadra and nagar haveli": "dadra and nagar haveli and daman and diu",
  "daman and diu": "dadra and nagar haveli and daman and diu",
};

/** The GST state code for a written state name, or null when it is not one we know. */
export function stateCodeFromName(name: string): string | null {
  const key = name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return STATE_CODES[STATE_ALIASES[key] ?? key] ?? null;
}

const STATE_NAMES_BY_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_CODES).map(([name, code]) => [code, name.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/ And /g, " and ")]),
);

/** The state or union territory a GST code stands for ("27" is "Maharashtra"), or null. */
export function stateNameFromCode(code: string): string | null {
  return STATE_NAMES_BY_CODE[code] ?? null;
}

const GSTIN_SHAPE = /^(\d{2})([A-Z]{5}\d{4}[A-Z])([1-9A-Z])Z([0-9A-Z])$/;
const CHECK_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** The 15th character of a GSTIN is a mod-36 check over the first 14. */
function gstinCheckCharacter(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const value = CHECK_ALPHABET.indexOf(first14[i]);
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHECK_ALPHABET[(36 - (sum % 36)) % 36];
}

/** True for a well-formed GSTIN with a valid state code and check character. Says nothing about whether it is registered. */
export function isValidGstin(value: string): boolean {
  const match = GSTIN_SHAPE.exec(value);
  if (!match) return false;
  const stateCode = Number(match[1]);
  if (stateCode < 1 || stateCode > 38 || stateCode === 25 || stateCode === 28) return false;
  return gstinCheckCharacter(value.slice(0, 14)) === value[14];
}

export const stateCodeOfGstin = (gstin: string): string => gstin.slice(0, 2);

export interface TaxSplit {
  /** Value before tax, in paise. */
  taxable: number;
  /** All tax, in paise. taxable + tax always equals the total. */
  tax: number;
}

/** Splits a GST-inclusive price: the price people see is the total, the tax is inside it. */
export function splitInclusive(totalPaise: number, ratePercent: number): TaxSplit {
  if (!Number.isInteger(totalPaise) || totalPaise < 0) throw new Error("The total must be a whole number of paise");
  if (!(ratePercent >= 0 && ratePercent <= 100)) throw new Error("The GST rate must be between 0 and 100");
  const taxable = Math.round((totalPaise * 100) / (100 + ratePercent));
  return { taxable, tax: totalPaise - taxable };
}

export interface TaxBreakdown extends TaxSplit {
  cgst: number;
  sgst: number;
  igst: number;
  /** Which tax applies: within the seller's state it is CGST + SGST; between states it is IGST. */
  kind: "CGST_SGST" | "IGST";
}

/** Intra-state supply: tax halves as CGST and SGST (an odd paisa goes to SGST). Inter-state: all IGST. */
export function breakdownTax(totalPaise: number, ratePercent: number, sellerStateCode: string, buyerStateCode: string | null): TaxBreakdown {
  const { taxable, tax } = splitInclusive(totalPaise, ratePercent);
  if (buyerStateCode !== null && buyerStateCode === sellerStateCode) {
    const cgst = Math.floor(tax / 2);
    return { taxable, tax, cgst, sgst: tax - cgst, igst: 0, kind: "CGST_SGST" };
  }
  return { taxable, tax, cgst: 0, sgst: 0, igst: tax, kind: "IGST" };
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Indian financial year ("2026-27") of a moment: April to March, by the calendar in India. */
export function financialYear(at: Date): string {
  const ist = new Date(at.getTime() + IST_OFFSET_MS);
  const year = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** "SR/2026-27/000042". The sequence restarts each financial year. */
export function formatInvoiceNumber(prefix: string, fy: string, sequence: number): string {
  return `${prefix}/${fy}/${String(sequence).padStart(6, "0")}`;
}
