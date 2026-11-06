import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { base32Decode, base32Encode, generateTotpSecret, matchTotp, otpauthUrl, stepAt, totpForStep } from "./totp.js";

// RFC 6238 appendix B: the SHA-1 secret is the ASCII string "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("base32", () => {
  it("matches the RFC 4648 test vectors", () => {
    for (const [plain, encoded] of [["f", "MY"], ["fo", "MZXQ"], ["foo", "MZXW6"], ["foob", "MZXW6YQ"], ["fooba", "MZXW6YTB"], ["foobar", "MZXW6YTBOI"]]) {
      assert.equal(base32Encode(Buffer.from(plain)), encoded);
      assert.equal(base32Decode(encoded).toString(), plain);
    }
  });

  it("reads what a person types: lower case, spaces, dashes", () => {
    assert.equal(base32Decode("mzxw 6ytb-oi").toString(), "foobar");
  });

  it("refuses characters outside the alphabet", () => {
    assert.throws(() => base32Decode("MZXW1"), /base32/);
  });
});

describe("TOTP (RFC 6238 vectors, SHA-1)", () => {
  it("produces the published codes", () => {
    // The RFC lists 8-digit codes; the 6-digit ones are their last six digits.
    const vectors: [number, string][] = [
      [59, "94287082"],
      [1111111109, "07081804"],
      [1111111111, "14050471"],
      [1234567890, "89005924"],
      [2000000000, "69279037"],
    ];
    for (const [seconds, code8] of vectors) {
      assert.equal(totpForStep(RFC_SECRET, stepAt(seconds * 1000), 8), code8, `t=${seconds}`);
      assert.equal(totpForStep(RFC_SECRET, stepAt(seconds * 1000)), code8.slice(2), `t=${seconds} (6 digits)`);
    }
  });
});

describe("matchTotp", () => {
  const now = 1_700_000_000_000;
  const current = stepAt(now);
  const codeFor = (step: number) => totpForStep(RFC_SECRET, step);

  it("accepts the current code and one step either side, and says which step it was", () => {
    assert.equal(matchTotp(RFC_SECRET, codeFor(current), now), current);
    assert.equal(matchTotp(RFC_SECRET, codeFor(current - 1), now), current - 1);
    assert.equal(matchTotp(RFC_SECRET, codeFor(current + 1), now), current + 1);
  });

  it("rejects older or newer codes, wrong codes and anything that is not six digits", () => {
    assert.equal(matchTotp(RFC_SECRET, codeFor(current - 2), now), null);
    assert.equal(matchTotp(RFC_SECRET, codeFor(current + 2), now), null);
    const wrong = codeFor(current) === "000000" ? "000001" : "000000";
    assert.equal(matchTotp(RFC_SECRET, wrong, now), null);
    for (const bad of ["", "12345", "1234567", "abcdef", "12 345", " 123456"]) assert.equal(matchTotp(RFC_SECRET, bad, now), null, JSON.stringify(bad));
  });
});

describe("secrets and links", () => {
  it("generates a fresh 160-bit secret each time", () => {
    const a = generateTotpSecret();
    assert.match(a, /^[A-Z2-7]{32}$/);
    assert.notEqual(a, generateTotpSecret());
    assert.equal(base32Decode(a).length, 20);
  });

  it("builds the link authenticator apps open", () => {
    const url = otpauthUrl("JBSWY3DPEHPK3PXP", "asha@example.test");
    assert.equal(url, "otpauth://totp/ShopRoom%3Aasha%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=ShopRoom&algorithm=SHA1&digits=6&period=30");
  });
});
