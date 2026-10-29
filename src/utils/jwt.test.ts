import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import jwt from "jsonwebtoken";
import {
  signCustomerToken,
  signPhoneVerifiedToken,
  signShopkeeperToken,
  verifyCustomerToken,
  verifyPhoneVerifiedToken,
  verifyShopkeeperToken,
} from "./jwt.js";

const SECRET = "unit-test-secret-unit-test-secret-1234";

describe("JWT helpers", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = SECRET;
    delete process.env.JWT_SECRET_PREVIOUS;
  });
  afterEach(() => {
    delete process.env.JWT_SECRET_PREVIOUS;
  });

  it("round-trips a customer token with its token version", () => {
    const payload = verifyCustomerToken(signCustomerToken("c1", 3));
    assert.equal(payload.sub, "c1");
    assert.equal(payload.tv, 3);
  });

  it("does not accept a token for the wrong role", () => {
    assert.throws(() => verifyShopkeeperToken(signCustomerToken("c1", 0)));
    assert.throws(() => verifyCustomerToken(signShopkeeperToken("s1", 0)));
    assert.throws(() => verifyCustomerToken(signPhoneVerifiedToken("d1", "9876543210")));
  });

  it("does not accept a phone-verification token as a session", () => {
    assert.equal(verifyPhoneVerifiedToken(signPhoneVerifiedToken("d1", "9876543210")).draftId, "d1");
    assert.throws(() => verifyShopkeeperToken(signPhoneVerifiedToken("d1", "9876543210")));
  });

  it("rejects an unsigned (alg: none) token", () => {
    const unsigned = jwt.sign({ sub: "c1", type: "customer", tv: 0 }, "", {
      algorithm: "none",
      issuer: "shoproom",
      audience: "customer",
    });
    assert.throws(() => verifyCustomerToken(unsigned));
  });

  it("rejects a token signed with another HMAC algorithm", () => {
    const forged = jwt.sign({ sub: "c1", type: "customer", tv: 0 }, SECRET, {
      algorithm: "HS512",
      issuer: "shoproom",
      audience: "customer",
    });
    assert.throws(() => verifyCustomerToken(forged));
  });

  it("rejects a token signed with the wrong secret", () => {
    const forged = jwt.sign({ sub: "c1", type: "customer", tv: 0 }, "attacker-secret", {
      algorithm: "HS256",
      issuer: "shoproom",
      audience: "customer",
    });
    assert.throws(() => verifyCustomerToken(forged));
  });

  it("rejects tokens without the expected issuer, audience or version claim", () => {
    const sign = (claims: object, options: jwt.SignOptions) =>
      jwt.sign(claims, SECRET, { algorithm: "HS256", ...options });
    const claims = { sub: "c1", type: "customer", tv: 0 };
    assert.throws(() => verifyCustomerToken(sign(claims, { audience: "customer" })));
    assert.throws(() => verifyCustomerToken(sign(claims, { issuer: "shoproom" })));
    assert.throws(() =>
      verifyCustomerToken(sign({ sub: "c1", type: "customer" }, { issuer: "shoproom", audience: "customer" })),
    );
  });

  it("rejects an expired token", () => {
    const expired = jwt.sign({ sub: "c1", type: "customer", tv: 0 }, SECRET, {
      algorithm: "HS256",
      issuer: "shoproom",
      audience: "customer",
      expiresIn: -10,
    });
    assert.throws(() => verifyCustomerToken(expired));
  });

  it("keeps old tokens valid during a secret rotation, then retires them", () => {
    const oldToken = signCustomerToken("c1", 0);

    process.env.JWT_SECRET = "the-new-secret-the-new-secret-123456";
    assert.throws(() => verifyCustomerToken(oldToken), "old secret no longer trusted by default");

    process.env.JWT_SECRET_PREVIOUS = SECRET;
    assert.equal(verifyCustomerToken(oldToken).sub, "c1");
    const fresh = signCustomerToken("c1", 0);
    delete process.env.JWT_SECRET_PREVIOUS;
    assert.equal(verifyCustomerToken(fresh).sub, "c1", "new tokens use the new secret");
  });
});
