import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createUnsubscribeToken, readUnsubscribeToken } from "./unsubscribeToken.js";

describe("unsubscribe token", () => {
  const original = process.env.JWT_SECRET;
  before(() => {
    process.env.JWT_SECRET = "a-test-secret-that-is-long-enough-0123456789";
  });
  after(() => {
    if (original === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = original;
  });

  it("returns the address it was made for", () => {
    assert.equal(readUnsubscribeToken(createUnsubscribeToken("asha@example.test")), "asha@example.test");
  });

  it("handles addresses with unusual characters", () => {
    const email = "o'brien+news@exämple.test";
    assert.equal(readUnsubscribeToken(createUnsubscribeToken(email)), email);
  });

  it("is safe to put in a URL", () => {
    assert.match(createUnsubscribeToken("asha@example.test"), /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it("rejects a token whose address was swapped for someone else's", () => {
    const [, signature] = createUnsubscribeToken("asha@example.test").split(".");
    const forged = `${Buffer.from("victim@example.test").toString("base64url")}.${signature}`;
    assert.equal(readUnsubscribeToken(forged), null);
  });

  it("rejects a token signed with a different secret", () => {
    const token = createUnsubscribeToken("asha@example.test");
    process.env.JWT_SECRET = "another-secret-that-is-also-long-enough-987654";
    assert.equal(readUnsubscribeToken(token), null);
    process.env.JWT_SECRET = "a-test-secret-that-is-long-enough-0123456789";
  });

  it("rejects malformed input without throwing", () => {
    for (const bad of ["", ".", "abc", "a.b.c", "!!!.???", "YQ.", ".YQ", "YQ.AAAA"]) assert.equal(readUnsubscribeToken(bad), null, `"${bad}"`);
  });
});
