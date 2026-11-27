import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, before, beforeEach, describe, it, mock } from "node:test";
import nodemailer from "nodemailer";
import { integrationConfigured, resetDatabase } from "../test/integration.js";
import { startTestApp, type TestApp } from "../test/http.js";

const enabled = integrationConfigured();

const SHOP = {
  shopName: "Sunrise Textiles",
  shopCategory: "Fashion",
  address: "12 Market Road",
  city: "Pune",
  state: "Maharashtra",
  pincode: "411001",
};

describe("shopkeeper registration and payments", { skip: !enabled }, () => {
  let t: TestApp;
  const sentEmails: { to: string; html: string }[] = [];
  let emailCounter = 0;

  before(async () => {
    // Integration tests exercise the credential-less development fallbacks.
    for (const name of Object.keys(process.env)) {
      if (/^(TWILIO|RAZORPAY)_/.test(name)) delete process.env[name];
    }
    delete process.env.NODE_ENV;
    mock.method(nodemailer, "createTransport", () => ({
      sendMail: async (message: { to: string; html: string }) => {
        sentEmails.push(message);
      },
    }));
    t = await startTestApp();
  });
  after(async () => {
    mock.restoreAll();
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await t.prisma.emailOtp.deleteMany();
    t.clearSessionCache();
    t.newClientIp();
    sentEmails.length = 0;
  });

  // The per-phone OTP limiter is real, so each registration gets its own number.
  let phoneCounter = 0;
  const uniquePhone = () => `9${String(100_000_000 + (phoneCounter += 1))}`;

  const uniqueEmail = () => `owner${(emailCounter += 1)}-${Date.now()}@example.test`;

  async function startDraft(email = uniqueEmail()) {
    const res = await t.call("POST", "/api/shopkeeper/draft/init", {
      body: { email, password: "owner-pass-123" },
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    return { email, draftId: res.json.draftId as string, response: res };
  }

  async function verifyPhone(draftId: string, phoneNumber = uniquePhone()) {
    assert.equal((await t.call("POST", "/api/shopkeeper/phone/send-otp", { body: { draftId, phoneNumber } })).status, 200);
    const res = await t.call("POST", "/api/shopkeeper/phone/verify-otp", { body: { draftId, code: "123456" } });
    assert.equal(res.status, 200, JSON.stringify(res.json));
  }

  async function draftReadyToPay(planType = "2m") {
    const { email, draftId } = await startDraft();
    const put = await t.call("PUT", `/api/shopkeeper/draft/${draftId}`, { body: { step: 2, data: SHOP } });
    assert.equal(put.status, 200, JSON.stringify(put.json));
    await verifyPhone(draftId);
    const order = await t.call("POST", "/api/shopkeeper/payment/create-order", { body: { draftId, planType } });
    assert.equal(order.status, 200, JSON.stringify(order.json));
    return { email, draftId, planType, orderId: order.json.orderId as string };
  }

  const pay = (draft: { draftId: string; planType: string }, orderId: string, paymentId: string) =>
    t.call("POST", "/api/shopkeeper/payment/verify", {
      body: {
        draftId: draft.draftId,
        planType: draft.planType,
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        razorpaySignature: "dev-mode-ignores-this",
      },
    });

  describe("drafts", () => {
    it("never returns the password hash, on creation or when restoring", async () => {
      const { email, response } = await startDraft();
      assert.equal(JSON.stringify(response.json).includes("passwordHash"), false);
      assert.equal(response.json.draft.currentStep, 1);

      const again = await t.call("POST", "/api/shopkeeper/draft/init", { body: { email, password: "owner-pass-123" } });
      assert.equal(again.json.restored, true);
      assert.equal(JSON.stringify(again.json).includes("passwordHash"), false);

      const wrong = await t.call("POST", "/api/shopkeeper/draft/init", { body: { email, password: "not-the-password" } });
      assert.equal(wrong.status, 400);
    });

    it("keeps server-managed fields out of reach of the client", async () => {
      const { draftId } = await startDraft();
      const res = await t.call("PUT", `/api/shopkeeper/draft/${draftId}`, {
        body: {
          step: 2,
          data: {
            ...SHOP,
            phoneNumber: "9000000001",
            logoUrl: "https://tracker.example.com/logo.png",
            passwordHash: "x",
            isAdmin: true,
          },
        },
      });
      assert.equal(res.status, 200);
      const draft = await t.prisma.shopkeeperDraft.findUniqueOrThrow({ where: { id: draftId } });
      const data = draft.data as Record<string, unknown>;
      assert.equal(data.shopName, SHOP.shopName);
      for (const forbidden of ["phoneNumber", "logoUrl", "passwordHash", "isAdmin"]) {
        assert.equal(forbidden in data, false, `${forbidden} must be dropped`);
      }
    });

    it("rejects malformed draft data", async () => {
      const { draftId } = await startDraft();
      for (const data of [{ latitude: "north" }, { latitude: 123 }, { pincode: "abc" }, { shopName: "x".repeat(500) }]) {
        const res = await t.call("PUT", `/api/shopkeeper/draft/${draftId}`, { body: { step: 2, data } });
        assert.equal(res.status, 400, JSON.stringify(data));
      }
    });

    it("voids phone verification when the number changes", async () => {
      const { draftId } = await startDraft();
      await t.call("PUT", `/api/shopkeeper/draft/${draftId}`, { body: { step: 2, data: SHOP } });
      await verifyPhone(draftId);
      assert.equal((await t.prisma.shopkeeperDraft.findUniqueOrThrow({ where: { id: draftId } })).phoneVerified, true);

      assert.equal(
        (await t.call("POST", "/api/shopkeeper/phone/send-otp", { body: { draftId, phoneNumber: uniquePhone() } })).status,
        200,
      );
      assert.equal((await t.prisma.shopkeeperDraft.findUniqueOrThrow({ where: { id: draftId } })).phoneVerified, false);

      const order = await t.call("POST", "/api/shopkeeper/payment/create-order", { body: { draftId, planType: "1m" } });
      assert.equal(order.status, 400);
    });

    it("refuses logo uploads for unknown drafts and non-image payloads without calling the image host", async () => {
      const png = "data:image/png;base64,iVBORw0KGgo=";
      const unknown = await t.call("POST", "/api/shopkeeper/upload-logo", { body: { draftId: "nope", image: png } });
      assert.equal(unknown.status, 400);

      const { draftId } = await startDraft();
      for (const image of ["data:image/svg+xml;base64,PHN2Zz4=", "data:text/html;base64,PGI+", "not-a-data-uri"]) {
        const res = await t.call("POST", "/api/shopkeeper/upload-logo", { body: { draftId, image } });
        assert.equal(res.status, 400, image);
      }
    });
  });

  describe("payment binding", () => {
    it("registers a shop when the paid order belongs to the draft", async () => {
      const draft = await draftReadyToPay("3m");
      const res = await pay(draft, draft.orderId, "pay_ok_1");
      assert.equal(res.status, 200, JSON.stringify(res.json));

      const me = await t.call("GET", "/api/shop/me", { token: res.json.token });
      assert.equal(me.status, 200);
      const shopkeeper = await t.prisma.shopkeeper.findUniqueOrThrow({ where: { id: res.json.shopkeeperId } });
      assert.equal(shopkeeper.razorpayPaymentId, "pay_ok_1");
      assert.equal(shopkeeper.planType, "3m");

      const ledger = await t.prisma.planPayment.findMany({ where: { shopkeeperId: shopkeeper.id } });
      assert.equal(ledger.length, 1, "registration is the first ledger entry");
      assert.deepEqual([ledger[0].purpose, ledger[0].planType, ledger[0].amount, ledger[0].razorpayPaymentId], ["REGISTRATION", "3m", 119_900, "pay_ok_1"]);
    });

    it("rejects a payment made for a different registration", async () => {
      const a = await draftReadyToPay();
      const b = await draftReadyToPay();
      const res = await pay(b, a.orderId, "pay_stolen");
      assert.equal(res.status, 400);
      assert.match(res.json.message, /does not belong/);
      assert.equal(await t.prisma.shopkeeper.count(), 0);
      assert.ok(await t.prisma.shopkeeperDraft.findUnique({ where: { id: b.draftId } }), "draft survives a rejected payment");
    });

    it("lets one payment buy one account only", async () => {
      const a = await draftReadyToPay();
      assert.equal((await pay(a, a.orderId, "pay_once")).status, 200);

      const b = await draftReadyToPay();
      const replay = await pay(b, b.orderId, "pay_once");
      assert.equal(replay.status, 409);
      assert.equal(await t.prisma.shopkeeper.count(), 1);

      // A different payment against an order that already bought the account has nothing to buy: it is sent back.
      const second = await pay(a, a.orderId, "pay_other");
      assert.equal(second.status, 200, "the account is unchanged and the person can carry on");
      assert.equal(await t.prisma.shopkeeper.count(), 1);
    });
  });

  describe("fails closed in production", () => {
    async function inProduction<T>(run: () => Promise<T> | T): Promise<T> {
      const previous = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      try {
        return await run();
      } finally {
        if (previous === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previous;
      }
    }

    it("does not wave payments through without Razorpay credentials", async () => {
      const razorpay = await import("../lib/razorpay.js");
      await inProduction(async () => {
        assert.equal(razorpay.verifyPaymentSignature("order_x", "pay_x", "sig"), false);
        await assert.rejects(razorpay.createRazorpayOrder({ amount: 39900, receipt: "po_x" }), /not configured/);
        await assert.rejects(razorpay.refundPayment("pay_x", 39900), /not configured/);
      });
    });

    it("does not treat phone verification as a no-op without Twilio credentials", async () => {
      const twilio = await import("../lib/twilioVerify.js");
      await inProduction(async () => {
        await assert.rejects(twilio.sendVerifyOtp("9876543210"), twilio.VerifyError);
        await assert.rejects(twilio.checkVerifyOtp("9876543210", "123456"), twilio.VerifyError);
      });
    });

    it("rejects a real signature too when payments are unconfigured", async () => {
      const razorpay = await import("../lib/razorpay.js");
      process.env.RAZORPAY_KEY_SECRET = "key-secret";
      try {
        const signature = createHmac("sha256", "key-secret").update("order_1|pay_1").digest("hex");
        assert.equal(razorpay.verifyPaymentSignature("order_1", "pay_1", signature), true);
        assert.equal(razorpay.verifyPaymentSignature("order_1", "pay_2", signature), false);
        assert.equal(razorpay.verifyPaymentSignature("order_1", "pay_1", "zz"), false);
      } finally {
        delete process.env.RAZORPAY_KEY_SECRET;
      }
    });
  });

  describe("Razorpay webhook", () => {
    const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_1", amount: 39900 } } } });
    const sign = (payload: string, secret: string) => createHmac("sha256", secret).update(payload).digest("hex");
    const post = (payload: string, signature?: string) =>
      t.call("POST", "/api/shopkeeper/payment/webhook", {
        rawBody: payload,
        headers: signature ? { "X-Razorpay-Signature": signature } : {},
      });

    it("accepts only correctly signed events", async () => {
      process.env.RAZORPAY_WEBHOOK_SECRET = "whsec_test";
      try {
        assert.equal((await post(body, sign(body, "whsec_test"))).status, 200);
        assert.equal((await post(body, sign(body, "another-secret"))).status, 401);
        assert.equal((await post(body.replace("39900", "1"), sign(body, "whsec_test"))).status, 401);
        assert.equal((await post(body, "short")).status, 401);
        assert.equal((await post(body)).status, 400);
      } finally {
        delete process.env.RAZORPAY_WEBHOOK_SECRET;
      }
    });

    it("rejects every event while no webhook secret is configured", async () => {
      assert.equal((await post(body, sign(body, ""))).status, 401);
    });
  });

  describe("email OTP", () => {
    const codeFrom = (html: string) => /(\d{6})<\/div>/.exec(html)?.[1] ?? "";

    async function sendCode(email: string) {
      const res = await t.call("POST", "/api/otp/send", { body: { email } });
      assert.equal(res.status, 200, JSON.stringify(res.json));
      return codeFrom(sentEmails.at(-1)!.html);
    }

    it("keeps a new customer out until the email is confirmed, then lets them sign in", async () => {
      const email = uniqueEmail();
      const password = "correct-horse-1";
      const registered = await t.call("POST", "/api/customers/register", { body: { fullName: "Otp User", email, password } });
      assert.equal(registered.status, 200, JSON.stringify(registered.json));
      assert.equal(registered.json.token, undefined, "registering starts no session");
      assert.equal(registered.headers.get("set-cookie"), null);

      const wrong = await t.call("POST", "/api/customers/login", { body: { email, password: "not-the-password-1" } });
      assert.equal(wrong.status, 401, "a wrong password learns nothing about the email being unconfirmed");
      assert.equal(wrong.json.code, undefined);

      const blocked = await t.call("POST", "/api/customers/login", { body: { email, password } });
      assert.equal(blocked.status, 403);
      assert.equal(blocked.json.code, "EMAIL_NOT_VERIFIED");
      assert.equal(blocked.json.token, undefined);

      const code = await sendCode(email);
      assert.equal((await t.call("POST", "/api/otp/verify", { body: { email, code } })).status, 200);

      const allowed = await t.call("POST", "/api/customers/login", { body: { email, password } });
      assert.equal(allowed.status, 200, JSON.stringify(allowed.json));
      assert.equal(typeof allowed.json.token, "string");
    });

    describe("confirming the email signs the person in", () => {
      const PASSWORD = "correct-horse-1";
      const register = async (email: string) => {
        const res = await t.call("POST", "/api/customers/register", { body: { fullName: "Otp User", email, password: PASSWORD } });
        assert.equal(res.status, 200, JSON.stringify(res.json));
        assert.equal(typeof res.json.verificationToken, "string", "sign-up hands out the verification token");
        return res.json as { customerId: string; verificationToken: string };
      };
      const confirm = (body: Record<string, unknown>, headers?: Record<string, string>) => t.call("POST", "/api/customers/verify-email", { body, headers });

      it("starts a session only when the code and the verification token are both right", async () => {
        const email = uniqueEmail();
        const { customerId, verificationToken } = await register(email);
        const code = await sendCode(email);

        const noToken = await confirm({ email, code });
        assert.equal(noToken.status, 400);
        assert.equal(noToken.json.token, undefined);

        const wrongCode = await confirm({ email, code: code === "000000" ? "111111" : "000000", verificationToken });
        assert.equal(wrongCode.status, 400);
        assert.equal(wrongCode.json.token, undefined);
        assert.equal((await t.prisma.customer.findUniqueOrThrow({ where: { id: customerId } })).emailVerified, false);

        const ok = await confirm({ email, code, verificationToken });
        assert.equal(ok.status, 200, JSON.stringify(ok.json));
        assert.equal(ok.json.customerId, customerId);
        assert.equal(typeof ok.json.token, "string");
        assert.equal((await t.prisma.customer.findUniqueOrThrow({ where: { id: customerId } })).emailVerified, true);
        assert.equal((await t.call("GET", "/api/customers/me", { headers: { Authorization: `Bearer ${ok.json.token}` } })).status, 200, "the session works");

        assert.equal((await confirm({ email, code, verificationToken })).status, 400, "the code works once");
      });

      it("puts the session in a cookie for the web app", async () => {
        const email = uniqueEmail();
        const { verificationToken } = await register(email);
        const code = await sendCode(email);
        const res = await confirm({ email, code, verificationToken }, { "X-Session-Mode": "cookie" });
        assert.equal(res.status, 200, JSON.stringify(res.json));
        assert.equal(res.json.token, undefined);
        assert.ok(res.headers.get("set-cookie")?.includes("sr_customer="));
      });

      it("refuses the code alone, as someone who only reads the mailbox would have it", async () => {
        const email = uniqueEmail();
        await register(email);
        const code = await sendCode(email);
        const res = await confirm({ email, code, verificationToken: "not-a-real-token-at-all" });
        assert.equal(res.status, 400);
        assert.equal(res.json.code, "VERIFICATION_EXPIRED");
        assert.equal(res.json.token, undefined);
        assert.equal(res.headers.get("set-cookie"), null);
      });

      it("refuses a token that belongs to another address", async () => {
        const first = uniqueEmail();
        const second = uniqueEmail();
        const a = await register(first);
        await register(second);
        const code = await sendCode(second);
        const res = await confirm({ email: second, code, verificationToken: a.verificationToken });
        assert.equal(res.status, 400);
        assert.equal(res.json.code, "VERIFICATION_EXPIRED");
      });

      it("voids the token when the password is reset", async () => {
        const email = uniqueEmail();
        const { customerId, verificationToken } = await register(email);
        await t.prisma.customer.update({ where: { id: customerId }, data: { tokenVersion: { increment: 1 } } });
        const code = await sendCode(email);
        const res = await confirm({ email, code, verificationToken });
        assert.equal(res.status, 400);
        assert.equal(res.json.code, "VERIFICATION_EXPIRED");
      });

      it("lets someone whose login was refused finish confirming, then signs them in", async () => {
        const email = uniqueEmail();
        await register(email);
        const refused = await t.call("POST", "/api/customers/login", { body: { email, password: PASSWORD } });
        assert.equal(refused.status, 403);
        assert.equal(refused.json.code, "EMAIL_NOT_VERIFIED");
        const verificationToken = refused.json.verificationToken as string;
        assert.equal(typeof verificationToken, "string");

        const code = await sendCode(email);
        const ok = await confirm({ email, code, verificationToken });
        assert.equal(ok.status, 200, JSON.stringify(ok.json));
        assert.equal(typeof ok.json.token, "string");
      });

      it("does not hand a token to a wrong password", async () => {
        const email = uniqueEmail();
        await register(email);
        const res = await t.call("POST", "/api/customers/login", { body: { email, password: "not-the-password-1" } });
        assert.equal(res.status, 401);
        assert.equal(res.json.verificationToken, undefined);
      });
    });

    it("stores only a digest of the code and verifies it once", async () => {
      const email = uniqueEmail();
      const customer = await t.call("POST", "/api/customers/register", {
        body: { fullName: "Otp User", email, password: "correct-horse-1" },
      });
      assert.equal(customer.status, 200);

      const code = await sendCode(email);
      assert.match(code, /^\d{6}$/);
      const row = await t.prisma.emailOtp.findFirstOrThrow({ where: { email } });
      assert.notEqual(row.code, code);
      assert.match(row.code, /^[0-9a-f]{64}$/);

      assert.equal((await t.call("POST", "/api/otp/verify", { body: { email, code } })).status, 200);
      assert.equal((await t.prisma.customer.findUniqueOrThrow({ where: { email } })).emailVerified, true);
      assert.equal((await t.call("POST", "/api/otp/verify", { body: { email, code } })).status, 400, "single use");
    });

    it("burns the code after too many wrong guesses, even if the right one follows", async () => {
      const email = uniqueEmail();
      const code = await sendCode(email);
      const wrong = code === "000000" ? "000001" : "000000";
      for (let i = 0; i < 5; i += 1) {
        assert.equal((await t.call("POST", "/api/otp/verify", { body: { email, code: wrong } })).status, 400);
      }
      const late = await t.call("POST", "/api/otp/verify", { body: { email, code } });
      assert.equal(late.status, 400);
      assert.equal(late.json.message, "Invalid or expired code");
    });

    it("rejects expired codes and malformed input", async () => {
      const email = uniqueEmail();
      const code = await sendCode(email);
      await t.prisma.emailOtp.updateMany({ where: { email }, data: { expiresAt: new Date(Date.now() - 1000) } });
      assert.equal((await t.call("POST", "/api/otp/verify", { body: { email, code } })).status, 400);
      for (const bad of ["12345", "1234567", "abcdef", "12 456"]) {
        assert.equal((await t.call("POST", "/api/otp/verify", { body: { email, code: bad } })).status, 400, bad);
      }
    });

    it("makes people wait between requests for a new code", async () => {
      const email = uniqueEmail();
      await sendCode(email);
      const again = await t.call("POST", "/api/otp/send", { body: { email } });
      assert.equal(again.status, 429);
      assert.equal(sentEmails.length, 1, "no second email goes out");
    });

    it("does not leak delivery failures to the caller", async () => {
      mock.restoreAll();
      mock.method(nodemailer, "createTransport", () => ({
        sendMail: async () => {
          throw new Error("connect ECONNREFUSED smtp.internal.example:587 (user=ops@shoproom)");
        },
      }));
      try {
        const res = await t.call("POST", "/api/otp/send", { body: { email: uniqueEmail() } });
        assert.equal(res.status, 500);
        assert.doesNotMatch(JSON.stringify(res.json), /ECONNREFUSED|smtp|ops@/);
        assert.equal(await t.prisma.emailOtp.count({ where: { used: false } }), 0, "an undelivered code is not left valid");
      } finally {
        mock.restoreAll();
        mock.method(nodemailer, "createTransport", () => ({
          sendMail: async (message: { to: string; html: string }) => {
            sentEmails.push(message);
          },
        }));
      }
    });
  });
});
