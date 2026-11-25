import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  connectTestEnvironment,
  createCustomer,
  createShop,
  integrationConfigured,
  resetDatabase,
  type TestPrisma,
} from "../test/integration.js";

const enabled = integrationConfigured();

describe("message scoping and account linking", { skip: !enabled }, () => {
  let prisma: TestPrisma;
  let messages: typeof import("./message.service.js");
  let customers: typeof import("./customers.service.js");
  let sessions: typeof import("./session.service.js");

  before(async () => {
    ({ prisma } = await connectTestEnvironment());
    messages = await import("./message.service.js");
    customers = await import("./customers.service.js");
    sessions = await import("./session.service.js");
  });
  after(() => prisma.$disconnect());
  beforeEach(async () => {
    await resetDatabase(prisma);
    sessions.clearSessionCache();
  });

  describe("messages cannot be reached through another room", () => {
    async function twoRooms() {
      const roomA = await createShop(prisma);
      const roomB = await createShop(prisma);
      // Belongs to both rooms, so passes the access check for either.
      const both = await createCustomer(prisma, { member: { roomId: roomA.roomId } });
      await prisma.membership.create({ data: { roomId: roomB.roomId, customerId: both.customerId } });
      const onlyB = await createCustomer(prisma, { member: { roomId: roomB.roomId } });
      const ctxBoth = { customerId: both.customerId };
      const inB = await messages.createMessage(roomB.roomId, "private to room B", { customerId: onlyB.customerId });
      const ownInB = await messages.createMessage(roomB.roomId, "mine, in B", ctxBoth);
      return { roomA, roomB, ctxBoth, inB, ownInB };
    }

    it("refuses to react to a message that lives in a different room", async () => {
      const { roomA, ctxBoth, inB } = await twoRooms();
      await assert.rejects(messages.reactToMessage(roomA.roomId, inB.id, "👍", ctxBoth), /Message not found/);
      assert.equal(await prisma.messageReaction.count(), 0);
    });

    it("refuses to edit or delete through the wrong room", async () => {
      const { roomA, roomB, ctxBoth, ownInB } = await twoRooms();
      await assert.rejects(messages.editMessage(roomA.roomId, ownInB.id, "changed", ctxBoth), /Message not found/);
      await assert.rejects(messages.deleteMessage(roomA.roomId, ownInB.id, "everyone", ctxBoth), /Message not found/);
      await assert.rejects(messages.deleteMessage(roomA.roomId, ownInB.id, "me", ctxBoth), /Message not found/);
      const row = await prisma.message.findUniqueOrThrow({ where: { id: ownInB.id } });
      assert.equal(row.deletedForEveryone, false);
      assert.equal(row.editedAt, null);
      assert.equal(await prisma.messageHiddenFor.count(), 0);

      // Through its own room the same actions work.
      const edited = await messages.editMessage(roomB.roomId, ownInB.id, "changed", ctxBoth);
      assert.equal(edited.text, "changed");
      assert.equal((await messages.reactToMessage(roomB.roomId, ownInB.id, "🔥", ctxBoth)).length, 1);
    });

    it("only accepts a real emoji as a reaction", async () => {
      for (const ok of ["👍", "❤️", "🙏🏽", "👨‍👩‍👧", "1️⃣", "🇮🇳"]) {
        assert.equal(messages.isValidReactionEmoji(ok), true, ok);
      }
      for (const bad of ["", "hello", "<script>", "👍 👍", "a", "👍\n", "x".repeat(40), "👍".repeat(9)]) {
        assert.equal(messages.isValidReactionEmoji(bad), false, JSON.stringify(bad));
      }
      const { roomB, ctxBoth, ownInB } = await twoRooms();
      await assert.rejects(messages.reactToMessage(roomB.roomId, ownInB.id, "<img onerror=x>", ctxBoth), /Invalid reaction/);
    });
  });

  describe("Google sign-in linking", () => {
    it("takes an unverified email account away from whoever registered it", async () => {
      const squatter = await customers.registerCustomer({
        fullName: "Squatter",
        email: "victim@example.test",
        password: "squatter-password",
        allowLocationAccess: false,
      });
      assert.ok(squatter.ok);
      const squatterSession = squatter.tokenVersion;
      assert.equal(await sessions.isSessionActive("customer", squatter.customer.id, squatterSession), true);

      const google = await customers.googleAuthCustomer({
        firebaseUid: "uid-victim",
        email: "victim@example.test",
        fullName: "Real Owner",
      });

      assert.equal(google.customer.id, squatter.customer.id);
      const row = await prisma.customer.findUniqueOrThrow({ where: { id: google.customer.id } });
      assert.equal(row.passwordHash, null, "the squatter's password is gone");
      assert.equal(row.emailVerified, true);
      assert.equal(row.firebaseUid, "uid-victim");
      assert.equal(await sessions.isSessionActive("customer", row.id, squatterSession), false, "their session is revoked");
      assert.equal(await sessions.isSessionActive("customer", row.id, google.tokenVersion), true);
      // The failure names the account that was tried (the sign-in audit log records it against that account).
      assert.deepEqual(await customers.loginCustomer({ email: "victim@example.test", password: "squatter-password" }), {
        ok: false,
        reason: "INVALID_CREDENTIALS",
        customerId: google.customer.id,
      });
    });

    it("keeps the password of an account whose email was already verified", async () => {
      const registered = await customers.registerCustomer({
        fullName: "Owner",
        email: "owner@example.test",
        password: "owner-password-1",
        allowLocationAccess: false,
      });
      assert.ok(registered.ok);
      await prisma.customer.update({ where: { id: registered.customer.id }, data: { emailVerified: true } });

      const google = await customers.googleAuthCustomer({
        firebaseUid: "uid-owner",
        email: "owner@example.test",
        fullName: "Owner",
      });
      const row = await prisma.customer.findUniqueOrThrow({ where: { id: google.customer.id } });
      assert.ok(row.passwordHash);
      assert.equal(row.tokenVersion, registered.tokenVersion);
      const login = await customers.loginCustomer({ email: "owner@example.test", password: "owner-password-1" });
      assert.equal(login.ok, true);
    });

    it("creates new Google customers as verified, without a password", async () => {
      const google = await customers.googleAuthCustomer({
        firebaseUid: "uid-new",
        email: "new@example.test",
        fullName: "New Person",
      });
      const row = await prisma.customer.findUniqueOrThrow({ where: { id: google.customer.id } });
      assert.equal(row.passwordHash, null);
      assert.equal(row.emailVerified, true);
    });

    it("never exposes the token version or hash in the customer object", async () => {
      const registered = await customers.registerCustomer({
        fullName: "Leak Check",
        email: "leak@example.test",
        password: "leak-check-password",
        allowLocationAccess: false,
      });
      assert.ok(registered.ok);
      const login = await customers.loginCustomer({ email: "leak@example.test", password: "leak-check-password" });
      assert.ok(login.ok);
      for (const customer of [registered.customer, login.customer]) {
        assert.deepEqual(
          Object.keys(customer).sort(),
          ["allowLocationAccess", "createdAt", "email", "fullName", "id", "latitude", "longitude", "updatedAt"],
        );
      }
    });
  });
});
