import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateUniqueInviteCode } from "./inviteCode.js";

/** Only the lookup the generator uses; an in-memory stand-in for the database. */
function fakeDb(taken: Set<string>) {
  return { room: { findUnique: async ({ where }: { where: { inviteCode: string } }) => (taken.has(where.inviteCode) ? { id: "x" } : null) } } as unknown as Parameters<typeof generateUniqueInviteCode>[0];
}

describe("invite codes", () => {
  it("are 8 characters from the unambiguous alphabet", async () => {
    for (let i = 0; i < 200; i += 1) {
      assert.match(await generateUniqueInviteCode(fakeDb(new Set())), /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    }
  });

  it("spread over the whole alphabet and do not repeat", async () => {
    const codes = new Set<string>();
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      const code = await generateUniqueInviteCode(fakeDb(new Set()));
      codes.add(code);
      for (const ch of code) seen.add(ch);
    }
    assert.equal(codes.size, 500, "no repeats among 500 draws from 2^40 codes");
    assert.equal(seen.size, 32, "every character of the alphabet shows up");
  });

  it("never returns a code that is already taken", async () => {
    const first = await generateUniqueInviteCode(fakeDb(new Set()));
    const next = await generateUniqueInviteCode(fakeDb(new Set([first])));
    assert.notEqual(next, first);
  });
});
