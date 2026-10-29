import assert from "node:assert/strict";
import { describe, it } from "node:test";
import bcrypt from "bcrypt";
import {
  BCRYPT_COST,
  MAX_PASSWORD_BYTES,
  hashPassword,
  needsRehash,
  newPasswordSchema,
  verifyPassword,
} from "./password.js";

describe("password helpers", () => {
  it("hashes at the current cost and verifies", async () => {
    const hash = await hashPassword("correct horse battery");
    assert.equal(bcrypt.getRounds(hash), BCRYPT_COST);
    assert.equal(await verifyPassword("correct horse battery", hash), true);
    assert.equal(await verifyPassword("wrong", hash), false);
  });

  it("returns false for a missing hash (and still does the work)", async () => {
    assert.equal(await verifyPassword("anything", null), false);
    assert.equal(await verifyPassword("anything", undefined), false);
    assert.equal(await verifyPassword("anything", ""), false);
  });

  it("flags hashes cheaper than the current cost for upgrade", async () => {
    assert.equal(needsRehash(await bcrypt.hash("pw", 10)), true);
    assert.equal(needsRehash(await hashPassword("pw")), false);
    assert.equal(needsRehash("not-a-hash"), false);
  });

  it("caps new passwords at bcrypt's 72-byte limit", () => {
    assert.equal(newPasswordSchema.safeParse("a".repeat(MAX_PASSWORD_BYTES)).success, true);
    assert.equal(newPasswordSchema.safeParse("a".repeat(MAX_PASSWORD_BYTES + 1)).success, false);
    // 40 two-byte characters is 80 bytes: short in characters, too long for bcrypt.
    assert.equal(newPasswordSchema.safeParse("é".repeat(40)).success, false);
    assert.equal(newPasswordSchema.safeParse("short").success, false);
  });
});
