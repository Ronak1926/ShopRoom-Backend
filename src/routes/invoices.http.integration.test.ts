import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createShop, integrationConfigured, resetDatabase } from "../test/integration.js";
import { startTestApp, type TestApp } from "../test/http.js";
import { financialYear } from "../utils/gst.js";

const enabled = integrationConfigured();

const SELLER = {
  INVOICE_SELLER_NAME: "Example Private Limited",
  INVOICE_SELLER_GSTIN: "27AAPFU0939F1ZV",
  INVOICE_SELLER_ADDRESS: "1 Example Road, Mumbai, Maharashtra - 400001",
  INVOICE_SAC: "998439",
  INVOICE_GST_RATE: "18",
};
const BUYER_GSTIN = "24AAACC1206D1ZM"; // Gujarat

describe("GST invoices", { skip: !enabled }, () => {
  let t: TestApp;
  const saved: Record<string, string | undefined> = {};
  let counter = 0;

  before(async () => {
    for (const name of [...Object.keys(SELLER), "INVOICE_PREFIX"]) saved[name] = process.env[name];
    t = await startTestApp();
  });
  after(async () => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await t.prisma.invoiceCounter.deleteMany();
    await t.prisma.invoiceArchive.deleteMany();
    t.clearSessionCache();
    t.newClientIp();
    Object.assign(process.env, SELLER);
    delete process.env.INVOICE_PREFIX;
  });

  async function shopkeeper(state = "Maharashtra", gstin: string | null = null) {
    const shop = await createShop(t.prisma);
    await t.prisma.shopkeeper.update({ where: { id: shop.shopkeeperId }, data: { state, gstin, shopName: "Sunrise Textiles", address: "12 Market Road", city: "Pune", pincode: "411001" } });
    return { id: shop.shopkeeperId, token: t.shopkeeperToken(shop.shopkeeperId) };
  }
  async function payment(shopkeeperId: string, o: { amount?: number; planType?: string; at?: Date } = {}) {
    counter += 1;
    return t.prisma.planPayment.create({
      data: {
        shopkeeperId,
        purpose: "RENEWAL",
        planType: o.planType ?? "1m",
        amount: o.amount ?? 39_900,
        razorpayOrderId: `order_Inv${counter}`,
        razorpayPaymentId: `pay_Inv${counter}`,
        ...(o.at ? { createdAt: o.at } : {}),
      },
    });
  }
  const invoice = (token: string | undefined, paymentId: string) => t.call("GET", `/api/shopkeeper/billing/invoices/${paymentId}`, { token });

  it("is switched off until the business has configured it", async () => {
    for (const name of Object.keys(SELLER)) delete process.env[name];
    const s = await shopkeeper();
    const p = await payment(s.id);
    const res = await invoice(s.token, p.id);
    assert.equal(res.status, 404);
    assert.match(res.json.message, /not available/i);
    assert.equal((await t.call("GET", "/api/shopkeeper/billing", { token: s.token })).json.data.invoicesEnabled, false);
    assert.equal(await t.prisma.invoiceCounter.count(), 0, "nothing was numbered");
  });

  it("issues a tax invoice that splits CGST and SGST for a buyer in the seller's state", async () => {
    const s = await shopkeeper("Maharashtra");
    const p = await payment(s.id, { amount: 39_900 });
    const res = await invoice(s.token, p.id);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const inv = res.json.data;
    assert.equal(inv.number, `SR/${financialYear(p.createdAt)}/000001`);
    assert.deepEqual(inv.seller, { name: SELLER.INVOICE_SELLER_NAME, gstin: SELLER.INVOICE_SELLER_GSTIN, address: SELLER.INVOICE_SELLER_ADDRESS });
    assert.equal(inv.buyer.name, "Sunrise Textiles");
    assert.equal(inv.buyer.address, "12 Market Road, Pune, Maharashtra - 411001");
    assert.deepEqual([inv.placeOfSupplyCode, inv.placeOfSupplyName], ["27", "Maharashtra"]);
    assert.equal(inv.description, "ShopRoom 1 Month plan (30 days)");
    assert.equal(inv.sac, "998439");
    assert.deepEqual([inv.tax.kind, inv.tax.taxable, inv.tax.cgst, inv.tax.sgst, inv.tax.igst], ["CGST_SGST", 33_814, 3_043, 3_043, 0]);
    assert.equal(inv.tax.taxable + inv.tax.cgst + inv.tax.sgst + inv.tax.igst, inv.total);
    assert.equal(inv.total, 39_900);
    assert.equal(inv.refunded, false);
    assert.equal(inv.razorpayPaymentId, p.razorpayPaymentId);
  });

  it("charges IGST to a buyer in another state, using their GSTIN's state when they gave one", async () => {
    const elsewhere = await shopkeeper("Karnataka");
    const a = (await invoice(elsewhere.token, (await payment(elsewhere.id)).id)).json.data;
    assert.deepEqual([a.tax.kind, a.tax.igst, a.tax.cgst, a.placeOfSupplyCode], ["IGST", a.tax.tax, 0, "29"]);

    // The GSTIN says Gujarat even though the shop's written state says Maharashtra.
    const withGstin = await shopkeeper("Maharashtra", BUYER_GSTIN);
    const b = (await invoice(withGstin.token, (await payment(withGstin.id)).id)).json.data;
    assert.deepEqual([b.tax.kind, b.placeOfSupplyCode, b.placeOfSupplyName, b.buyer.gstin], ["IGST", "24", "Gujarat", BUYER_GSTIN], "the name follows the code that decided the tax");
  });

  it("does not guess a state it cannot read: it charges IGST and leaves the place of supply empty", async () => {
    const s = await shopkeeper("MH");
    const inv = (await invoice(s.token, (await payment(s.id)).id)).json.data;
    assert.deepEqual([inv.tax.kind, inv.placeOfSupplyCode, inv.placeOfSupplyName], ["IGST", null, null]);
  });

  it("gives the same invoice every time, and consecutive numbers to different payments", async () => {
    const s = await shopkeeper();
    const [p1, p2, p3] = [await payment(s.id), await payment(s.id), await payment(s.id)];
    const first = (await invoice(s.token, p1.id)).json.data.number;
    assert.equal((await invoice(s.token, p1.id)).json.data.number, first, "asking again does not renumber");
    const numbers = [first, (await invoice(s.token, p2.id)).json.data.number, (await invoice(s.token, p3.id)).json.data.number];
    assert.deepEqual(numbers.map((n: string) => n.slice(-6)), ["000001", "000002", "000003"]);
  });

  it("never repeats or skips a number when invoices are requested at the same moment", async () => {
    const shops = await Promise.all(Array.from({ length: 4 }, () => shopkeeper()));
    const payments = await Promise.all(shops.flatMap((s) => [payment(s.id), payment(s.id)]).map(async (p, i) => ({ p: await p, token: shops[Math.floor(i / 2)].token })));
    const results = await Promise.all(payments.map(({ p, token }) => invoice(token, p.id)));
    assert.ok(results.every((r) => r.status === 200), JSON.stringify(results.map((r) => r.status)));
    const sequence = results.map((r) => Number(r.json.data.number.slice(-6))).sort((a, b) => a - b);
    assert.deepEqual(sequence, [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(new Set(results.map((r) => r.json.data.number)).size, 8);
  });

  it("starts a new sequence each financial year, numbering by the payment's own date", async () => {
    const s = await shopkeeper();
    const lastYear = await payment(s.id, { at: new Date("2025-06-15T10:00:00Z") });
    const thisYear = await payment(s.id, { at: new Date("2026-06-15T10:00:00Z") });
    assert.equal((await invoice(s.token, lastYear.id)).json.data.number, "SR/2025-26/000001");
    assert.equal((await invoice(s.token, thisYear.id)).json.data.number, "SR/2026-27/000001");
    assert.equal((await invoice(s.token, (await payment(s.id, { at: new Date("2026-07-01T10:00:00Z") })).id)).json.data.number, "SR/2026-27/000002");
  });

  it("uses the configured prefix", async () => {
    process.env.INVOICE_PREFIX = "ACME";
    const s = await shopkeeper();
    assert.match((await invoice(s.token, (await payment(s.id)).id)).json.data.number, /^ACME\/\d{4}-\d{2}\/000001$/);
  });

  it("freezes what was issued: later edits to the shop or GSTIN do not change an existing invoice", async () => {
    const s = await shopkeeper("Maharashtra");
    const p = await payment(s.id);
    const before = (await invoice(s.token, p.id)).json.data;

    await t.prisma.shopkeeper.update({ where: { id: s.id }, data: { shopName: "Renamed Shop", address: "99 New Road", state: "Gujarat", gstin: BUYER_GSTIN } });
    process.env.INVOICE_GST_RATE = "12";
    const after = (await invoice(s.token, p.id)).json.data;
    assert.deepEqual(after, before);

    // A payment first invoiced now reflects the new details.
    const later = (await invoice(s.token, (await payment(s.id)).id)).json.data;
    assert.equal(later.buyer.name, "Renamed Shop");
    assert.equal(later.ratePercent, 12);
  });

  it("only shows a shopkeeper their own invoices", async () => {
    const mine = await shopkeeper();
    const theirs = await shopkeeper();
    const theirPayment = await payment(theirs.id);
    assert.equal((await invoice(mine.token, theirPayment.id)).status, 404);
    assert.equal((await invoice(undefined, theirPayment.id)).status, 401);
    assert.equal((await invoice(mine.token, "does-not-exist")).status, 404);
    assert.equal((await invoice(mine.token, "x".repeat(60))).status, 404);
    assert.equal(await t.prisma.invoiceCounter.count(), 0, "a refused request used up no number");
    assert.equal((await t.prisma.planPayment.findUniqueOrThrow({ where: { id: theirPayment.id } })).invoiceNumber, null);
  });

  it("marks an invoice for a refunded payment, and keeps it", async () => {
    const s = await shopkeeper();
    const p = await payment(s.id);
    const issued = (await invoice(s.token, p.id)).json.data;
    await t.prisma.planPayment.update({ where: { id: p.id }, data: { refundedAt: new Date() } });
    const after = (await invoice(s.token, p.id)).json.data;
    assert.equal(after.refunded, true);
    assert.equal(after.number, issued.number);
  });

  it("keeps a copy of issued invoices when the account is deleted, and carries on the numbering", async () => {
    const mine = await shopkeeper();
    await t.prisma.shopkeeper.update({ where: { id: mine.id }, data: { passwordHash: await (await import("../utils/password.js")).hashPassword("owner-pass-123") } });
    const issued = (await invoice(mine.token, (await payment(mine.id)).id)).json.data;
    await payment(mine.id); // never opened: it has no invoice, so there is nothing to keep

    assert.equal((await t.call("DELETE", "/api/shopkeeper/me", { token: mine.token, body: { password: "owner-pass-123" } })).status, 200);
    assert.equal(await t.prisma.planPayment.count(), 0, "the account's payments are gone");
    const kept = await t.prisma.invoiceArchive.findMany();
    assert.equal(kept.length, 1);
    assert.equal(kept[0].invoiceNumber, issued.number);
    assert.equal((kept[0].snapshot as { buyer: { name: string } }).buyer.name, "Sunrise Textiles");

    const next = await shopkeeper();
    assert.match((await invoice(next.token, (await payment(next.id)).id)).json.data.number, /000002$/, "the sequence did not restart or reuse a number");
  });

  describe("the GSTIN printed as the buyer's", () => {
    const put = (token: string, gstin: unknown) => t.call("PUT", "/api/shopkeeper/billing/gstin", { token, body: { gstin } });

    it("saves a valid one (tidied), shows it in billing, and clears it", async () => {
      const s = await shopkeeper();
      assert.equal((await put(s.token, `  ${BUYER_GSTIN.toLowerCase()} `)).status, 200);
      assert.equal((await t.call("GET", "/api/shopkeeper/billing", { token: s.token })).json.data.gstin, BUYER_GSTIN);
      assert.equal((await put(s.token, null)).status, 200);
      assert.equal((await t.call("GET", "/api/shopkeeper/billing", { token: s.token })).json.data.gstin, null);
      assert.equal((await put(s.token, "")).status, 200);
    });

    it("refuses one that is not valid and changes nothing", async () => {
      const s = await shopkeeper("Maharashtra", BUYER_GSTIN);
      for (const bad of ["27AAPFU0939F1ZX", "not-a-gstin", "29GGGGG1314R9Z6", "27AAPFU0939F1ZVV"]) {
        assert.equal((await put(s.token, bad)).status, 400, bad);
      }
      assert.equal((await put(s.token, 12345)).status, 400);
      assert.equal((await t.call("GET", "/api/shopkeeper/billing", { token: s.token })).json.data.gstin, BUYER_GSTIN);
      assert.equal((await t.call("PUT", "/api/shopkeeper/billing/gstin", { body: { gstin: BUYER_GSTIN } })).status, 401);
    });
  });
});
