import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { breakdownTax, financialYear, formatInvoiceNumber, isValidGstin, splitInclusive, stateCodeFromName, stateCodeOfGstin, stateNameFromCode } from "./gst.js";

describe("GSTIN", () => {
  it("accepts well-known valid numbers (shape, state code and check character)", () => {
    for (const gstin of ["27AAPFU0939F1ZV", "24AAACC1206D1ZM"]) assert.equal(isValidGstin(gstin), true, gstin);
  });

  it("rejects a single wrong character anywhere, via the check character", () => {
    const good = "27AAPFU0939F1ZV";
    for (let i = 2; i < 14; i += 1) {
      const alphabet = /[0-9]/.test(good[i]) ? "0123456789" : "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const other = alphabet[(alphabet.indexOf(good[i]) + 1) % alphabet.length];
      assert.equal(isValidGstin(good.slice(0, i) + other + good.slice(i + 1)), false, `changed position ${i}`);
    }
  });

  it("rejects wrong shapes, lengths, case and impossible state codes", () => {
    // "29GGGGG1314R9Z6" is the format sample often quoted in guides: right shape, wrong check character.
    for (const bad of ["29GGGGG1314R9Z6", "", "27AAPFU0939F1Z", "27AAPFU0939F1ZVV", "27aapfu0939f1zv", "27AAPFU0939F1AV", "00AAPFU0939F1ZV", "99AAPFU0939F1ZV", "25AAPFU0939F1ZV", " 27AAPFU0939F1ZV"]) {
      assert.equal(isValidGstin(bad), false, JSON.stringify(bad));
    }
  });

  it("reads the state code from the first two digits", () => {
    assert.equal(stateCodeOfGstin("27AAPFU0939F1ZV"), "27");
  });
});

describe("state names", () => {
  it("maps names however they are written", () => {
    assert.equal(stateCodeFromName("Maharashtra"), "27");
    assert.equal(stateCodeFromName("  tamil   nadu "), "33");
    assert.equal(stateCodeFromName("Jammu & Kashmir"), "01");
    assert.equal(stateCodeFromName("Orissa"), "21");
    assert.equal(stateCodeFromName("NCT of Delhi"), "07");
    assert.equal(stateCodeFromName("Daman and Diu"), "26");
  });

  it("names a state from its code, and every code round-trips", () => {
    assert.equal(stateNameFromCode("27"), "Maharashtra");
    assert.equal(stateNameFromCode("24"), "Gujarat");
    assert.equal(stateNameFromCode("04"), "Chandigarh");
    assert.equal(stateNameFromCode("35"), "Andaman and Nicobar Islands");
    assert.equal(stateNameFromCode("01"), "Jammu and Kashmir");
    assert.equal(stateNameFromCode("99"), null);
    for (let code = 1; code <= 38; code += 1) {
      const key = String(code).padStart(2, "0");
      const name = stateNameFromCode(key);
      if (name) assert.equal(stateCodeFromName(name), key, name);
    }
  });

  it("says nothing for what it does not know, rather than guessing", () => {
    for (const unknown of ["MH", "", "Atlantis", "27"]) assert.equal(stateCodeFromName(unknown), null, JSON.stringify(unknown));
  });
});

describe("splitting a GST-inclusive price", () => {
  it("takes the tax out of the total at 18%", () => {
    // 399.00 inclusive: taxable 338.14, tax 60.86.
    assert.deepEqual(splitInclusive(39_900, 18), { taxable: 33_814, tax: 6_086 });
    assert.deepEqual(splitInclusive(89_900, 18), { taxable: 76_186, tax: 13_714 });
  });

  it("always adds back to the total, for any price and rate", () => {
    for (const rate of [0, 5, 12, 18, 28]) {
      for (let total = 0; total < 3_000; total += 7) {
        const { taxable, tax } = splitInclusive(total, rate);
        assert.equal(taxable + tax, total, `${total} at ${rate}%`);
        assert.ok(tax >= 0 && taxable >= 0);
      }
    }
  });

  it("is exact at 0% and refuses nonsense", () => {
    assert.deepEqual(splitInclusive(39_900, 0), { taxable: 39_900, tax: 0 });
    assert.throws(() => splitInclusive(10.5, 18));
    assert.throws(() => splitInclusive(-1, 18));
    assert.throws(() => splitInclusive(100, 101));
    assert.throws(() => splitInclusive(100, Number.NaN));
  });
});

describe("CGST, SGST and IGST", () => {
  it("halves the tax within the seller's state, and gives an odd paisa to SGST", () => {
    const b = breakdownTax(39_900, 18, "27", "27");
    assert.equal(b.kind, "CGST_SGST");
    assert.deepEqual([b.cgst, b.sgst, b.igst], [3_043, 3_043, 0]);
    assert.equal(b.cgst + b.sgst, b.tax);

    const odd = breakdownTax(59_900, 18, "27", "27"); // tax 9137: odd
    assert.equal(odd.cgst + odd.sgst, odd.tax);
    assert.equal(odd.sgst - odd.cgst, 1);
  });

  it("charges IGST between states, and when the buyer's state is not known", () => {
    for (const buyer of ["29", null]) {
      const b = breakdownTax(39_900, 18, "27", buyer);
      assert.equal(b.kind, "IGST");
      assert.deepEqual([b.cgst, b.sgst, b.igst], [0, 0, b.tax]);
    }
  });
});

describe("financial year and invoice numbers", () => {
  it("runs April to March by the calendar in India", () => {
    assert.equal(financialYear(new Date("2026-04-01T00:00:00+05:30")), "2026-27");
    assert.equal(financialYear(new Date("2026-03-31T23:59:59+05:30")), "2025-26");
    assert.equal(financialYear(new Date("2026-11-06T10:00:00Z")), "2026-27");
    assert.equal(financialYear(new Date("2027-01-15T10:00:00Z")), "2026-27");
    assert.equal(financialYear(new Date("2099-12-31T10:00:00Z")), "2099-00");
  });

  it("uses India's date, not UTC's, around midnight", () => {
    // 20:00 UTC on 31 March is 01:30 IST on 1 April: already the new year.
    assert.equal(financialYear(new Date("2026-03-31T20:00:00Z")), "2026-27");
    assert.equal(financialYear(new Date("2026-03-31T18:00:00Z")), "2025-26");
  });

  it("formats a padded, prefixed number", () => {
    assert.equal(formatInvoiceNumber("SR", "2026-27", 42), "SR/2026-27/000042");
    assert.equal(formatInvoiceNumber("ACME", "2025-26", 1_234_567), "ACME/2025-26/1234567");
  });
});
