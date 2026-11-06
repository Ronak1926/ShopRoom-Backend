import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { invoiceConfigIsPartial, invoiceSeller } from "./invoice.js";

const COMPLETE = {
  INVOICE_SELLER_NAME: "Example Private Limited",
  INVOICE_SELLER_GSTIN: "27AAPFU0939F1ZV",
  INVOICE_SELLER_ADDRESS: "1 Example Road, Mumbai, Maharashtra - 400001",
  INVOICE_SAC: "998439",
  INVOICE_GST_RATE: "18",
};

describe("invoice configuration", () => {
  it("is off until everything is set", () => {
    assert.equal(invoiceSeller({}), null);
    for (const missing of Object.keys(COMPLETE)) {
      const env: Record<string, string> = { ...COMPLETE };
      delete env[missing];
      assert.equal(invoiceSeller(env), null, `without ${missing}`);
    }
  });

  it("reads a complete configuration, taking the state from the GSTIN", () => {
    assert.deepEqual(invoiceSeller(COMPLETE), {
      name: "Example Private Limited",
      gstin: "27AAPFU0939F1ZV",
      address: "1 Example Road, Mumbai, Maharashtra - 400001",
      stateCode: "27",
      sac: "998439",
      ratePercent: 18,
      prefix: "SR",
    });
  });

  it("tidies what was typed: spaces and lower case in the GSTIN, a custom prefix", () => {
    const seller = invoiceSeller({ ...COMPLETE, INVOICE_SELLER_GSTIN: " 27aapfu0939f1zv ", INVOICE_PREFIX: "acme" });
    assert.equal(seller, null, "a lower-case prefix is not a valid prefix");
    assert.equal(invoiceSeller({ ...COMPLETE, INVOICE_SELLER_GSTIN: " 27aapfu0939f1zv ", INVOICE_PREFIX: "ACME" })?.gstin, "27AAPFU0939F1ZV");
  });

  it("refuses an invalid GSTIN, SAC, rate or prefix rather than printing wrong invoices", () => {
    for (const bad of [
      { INVOICE_SELLER_GSTIN: "27AAPFU0939F1ZX" },
      { INVOICE_SAC: "99A" },
      { INVOICE_SAC: "1234567890" },
      { INVOICE_GST_RATE: "eighteen" },
      { INVOICE_GST_RATE: "-1" },
      { INVOICE_GST_RATE: "101" },
      { INVOICE_PREFIX: "TOO-LONG-PREFIX" },
    ]) {
      assert.equal(invoiceSeller({ ...COMPLETE, ...bad }), null, JSON.stringify(bad));
    }
  });

  it("accepts a 0% rate (an exempt supply is a real choice)", () => {
    assert.equal(invoiceSeller({ ...COMPLETE, INVOICE_GST_RATE: "0" })?.ratePercent, 0);
  });

  it("says when it is half-configured, so a typo is noticed, but not when it is simply unused", () => {
    assert.equal(invoiceConfigIsPartial({}), false);
    assert.equal(invoiceConfigIsPartial(COMPLETE), false);
    assert.equal(invoiceConfigIsPartial({ INVOICE_SELLER_NAME: "Example" }), true);
    assert.equal(invoiceConfigIsPartial({ ...COMPLETE, INVOICE_SELLER_GSTIN: "bad" }), true);
  });
});
