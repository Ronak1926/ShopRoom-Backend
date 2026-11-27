import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { isEmailConfigured, sendContactEmail, sendOtpEmail } from "./email.js";

const KEYS = ["BREVO_API_KEY", "MAIL_FROM", "SMTP_FROM", "SMTP_HOST", "SMTP_USER"] as const;

describe("email over HTTPS", () => {
  const saved: Record<string, string | undefined> = {};
  let calls: { url: string; init: RequestInit }[] = [];

  beforeEach(() => {
    for (const key of KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    process.env.BREVO_API_KEY = "test-key";
    process.env.MAIL_FROM = "CounterCircle <hello@example.test>";
    calls = [];
    mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ messageId: "m1" }), { status: 201 });
    });
  });

  afterEach(() => {
    mock.restoreAll();
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("sends the code through the provider API with the key in a header, not the body", async () => {
    await sendOtpEmail("asha@example.test", "123456");
    assert.equal(calls.length, 1);
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers["api-key"], "test-key");
    const body = JSON.parse(String(calls[0].init.body));
    assert.deepEqual(body.sender, { name: "CounterCircle", email: "hello@example.test" });
    assert.deepEqual(body.to, [{ email: "asha@example.test" }]);
    assert.ok(body.htmlContent.includes("123456"));
    assert.ok(!JSON.stringify(body).includes("test-key"));
  });

  it("accepts a bare sender address", async () => {
    process.env.MAIL_FROM = "hello@example.test";
    await sendOtpEmail("asha@example.test", "123456");
    assert.deepEqual(JSON.parse(String(calls[0].init.body)).sender, { email: "hello@example.test" });
  });

  it("keeps the visitor's address in Reply-To for contact messages", async () => {
    await sendContactEmail("team@example.test", { name: "Asha", email: "asha@example.test", subject: "Hi", message: "Hello there" });
    const body = JSON.parse(String(calls[0].init.body));
    assert.deepEqual(body.replyTo, { email: "asha@example.test" });
    assert.equal(body.sender.email, "hello@example.test");
  });

  it("fails with the status when the provider refuses, without leaking the key", async () => {
    mock.restoreAll();
    mock.method(globalThis, "fetch", async () => new Response('{"message":"sender not verified"}', { status: 400 }));
    await assert.rejects(sendOtpEmail("asha@example.test", "123456"), (err: Error) => {
      assert.match(err.message, /400/);
      assert.ok(!err.message.includes("test-key"));
      return true;
    });
  });

  it("refuses to send without a sender", async () => {
    delete process.env.MAIL_FROM;
    await assert.rejects(sendOtpEmail("asha@example.test", "123456"), /sender/i);
    assert.equal(calls.length, 0);
  });

  it("counts as configured only when a sender exists", () => {
    assert.equal(isEmailConfigured(), true);
    delete process.env.MAIL_FROM;
    assert.equal(isEmailConfigured(), false);
  });
});
