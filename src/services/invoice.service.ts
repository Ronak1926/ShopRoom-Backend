/**
 * services/invoice.service.ts — GST tax invoices for plan payments.
 *
 * An invoice is created the first time it is asked for, as a frozen snapshot: who sold, who bought
 * (as they were that day), the sums, and a number from a gap-free sequence for the financial year.
 * Editing a shop's address or GSTIN later never changes an invoice that already exists.
 *
 * Numbers: the counter row and the payment row are locked in the same transaction, so two requests
 * can never take the same number, and a number is only ever used if the invoice that carries it
 * is saved (no gaps).
 */

import { Prisma } from "../generated/client.js";
import { prisma } from "../database/prisma.js";
import { invoiceSeller, type InvoiceSeller } from "../config/invoice.js";
import { breakdownTax, financialYear, formatInvoiceNumber, isValidGstin, stateCodeFromName, stateCodeOfGstin, stateNameFromCode, type TaxBreakdown } from "../utils/gst.js";
import { isPlanId, PLANS } from "./plans.js";

/** Everything printed on the invoice. Stored as JSON, so it stays exactly as it was issued. */
export interface InvoiceSnapshot {
  number: string;
  issuedOn: string;
  seller: { name: string; gstin: string; address: string };
  buyer: { name: string; address: string; state: string; gstin: string | null };
  placeOfSupplyCode: string | null;
  /** The state that code stands for, so the name and the tax always agree. Null when the state could not be read. */
  placeOfSupplyName: string | null;
  description: string;
  sac: string;
  ratePercent: number;
  tax: TaxBreakdown;
  /** Total in paise, tax included. */
  total: number;
  razorpayPaymentId: string;
}

export type InvoiceView = InvoiceSnapshot & { refunded: boolean };
export type InvoiceResult = { status: "ok"; invoice: InvoiceView } | { status: "disabled" } | { status: "not-found" };

async function nextSequence(tx: Prisma.TransactionClient, fy: string): Promise<number> {
  const [row] = await tx.$queryRaw<{ lastNumber: number }[]>`
    INSERT INTO "InvoiceCounter" ("financialYear", "lastNumber") VALUES (${fy}, 1)
    ON CONFLICT ("financialYear") DO UPDATE SET "lastNumber" = "InvoiceCounter"."lastNumber" + 1
    RETURNING "lastNumber"`;
  return row.lastNumber;
}

async function issue(tx: Prisma.TransactionClient, seller: InvoiceSeller, payment: { id: string; shopkeeperId: string; planType: string; amount: number; createdAt: Date; razorpayPaymentId: string }): Promise<InvoiceSnapshot> {
  const buyer = await tx.shopkeeper.findUniqueOrThrow({
    where: { id: payment.shopkeeperId },
    select: { shopName: true, ownerName: true, address: true, city: true, state: true, pincode: true, gstin: true },
  });
  const buyerStateCode = buyer.gstin ? stateCodeOfGstin(buyer.gstin) : stateCodeFromName(buyer.state);
  const tax = breakdownTax(payment.amount, seller.ratePercent, seller.stateCode, buyerStateCode);
  const label = isPlanId(payment.planType) ? `${PLANS[payment.planType].label} plan (${PLANS[payment.planType].days} days)` : `${payment.planType} plan`;

  const fy = financialYear(payment.createdAt);
  const number = formatInvoiceNumber(seller.prefix, fy, await nextSequence(tx, fy));
  const snapshot: InvoiceSnapshot = {
    number,
    issuedOn: payment.createdAt.toISOString(),
    seller: { name: seller.name, gstin: seller.gstin, address: seller.address },
    buyer: {
      name: buyer.shopName,
      address: `${buyer.address}, ${buyer.city}, ${buyer.state} - ${buyer.pincode}`,
      state: buyer.state,
      gstin: buyer.gstin,
    },
    placeOfSupplyCode: buyerStateCode,
    placeOfSupplyName: buyerStateCode ? stateNameFromCode(buyerStateCode) : null,
    description: `ShopRoom ${label}`,
    sac: seller.sac,
    ratePercent: seller.ratePercent,
    tax,
    total: payment.amount,
    razorpayPaymentId: payment.razorpayPaymentId,
  };
  await tx.planPayment.update({ where: { id: payment.id }, data: { invoiceNumber: number, invoiceSnapshot: snapshot as unknown as Prisma.InputJsonValue, invoicedAt: new Date() } });
  return snapshot;
}

/** The invoice for one of the shopkeeper's payments, issuing it first if this is the first request. */
export async function getInvoice(shopkeeperId: string, paymentId: string, seller: InvoiceSeller | null = invoiceSeller()): Promise<InvoiceResult> {
  if (!seller) return { status: "disabled" };

  return prisma.$transaction(
    async (tx): Promise<InvoiceResult> => {
      const [locked] = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "PlanPayment" WHERE "id" = ${paymentId} AND "shopkeeperId" = ${shopkeeperId} FOR UPDATE`;
      if (!locked) return { status: "not-found" };
      const payment = await tx.planPayment.findUniqueOrThrow({
        where: { id: paymentId },
        select: { id: true, shopkeeperId: true, planType: true, amount: true, createdAt: true, razorpayPaymentId: true, refundedAt: true, invoiceSnapshot: true },
      });
      const snapshot = payment.invoiceSnapshot ? (payment.invoiceSnapshot as unknown as InvoiceSnapshot) : await issue(tx, seller, payment);
      return { status: "ok", invoice: { ...snapshot, refunded: payment.refundedAt !== null } };
    },
    { timeout: 15_000 },
  );
}

/** Sets (or clears, with null) the GSTIN printed on future invoices. Returns false when it is not a valid GSTIN. */
export async function setBuyerGstin(shopkeeperId: string, gstin: string | null): Promise<boolean> {
  const value = gstin?.trim().toUpperCase() || null;
  if (value !== null && !isValidGstin(value)) return false;
  await prisma.shopkeeper.update({ where: { id: shopkeeperId }, data: { gstin: value } });
  return true;
}
