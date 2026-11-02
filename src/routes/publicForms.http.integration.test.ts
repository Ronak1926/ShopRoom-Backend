import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it, mock } from "node:test";
import nodemailer from "nodemailer";
import { integrationConfigured, resetDatabase } from "../test/integration.js";
import { startTestApp, type TestApp } from "../test/http.js";

const enabled = integrationConfigured();

interface Mail {
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
}

describe("public site forms", { skip: !enabled }, () => {
  let t: TestApp;
  const mails: Mail[] = [];
  let failSending = false;

  before(async () => {
    process.env.CONTACT_EMAIL = "support@shoproom.example";
    mock.method(nodemailer, "createTransport", () => ({
      sendMail: async (mail: Mail) => {
        if (failSending) throw new Error("smtp down");
        mails.push(mail);
      },
    }));
    t = await startTestApp();
  });
  after(async () => {
    mock.restoreAll();
    delete process.env.CONTACT_EMAIL;
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await t.prisma.newsletterSubscriber.deleteMany();
    t.newClientIp();
    mails.length = 0;
    failSending = false;
  });

  const GOOD = { name: "Asha", email: "Asha@Example.test", subject: "Pricing question", message: "Do you offer a discount for two shops?" };
  const contact = (body: unknown) => t.call("POST", "/api/public/contact", { body });
  /** For loops of rejected requests: each one comes from a new client, so the per-client limit never interferes. */
  const contactFromNewClient = (body: unknown) => {
    t.newClientIp();
    return contact(body);
  };
  const subscribe = (body: unknown) => t.call("POST", "/api/public/newsletter", { body });

  describe("contact", () => {
    it("relays the message to the support inbox, with the sender as reply-to", async () => {
      const res = await contact(GOOD);
      assert.equal(res.status, 202, JSON.stringify(res.json));
      assert.equal(mails.length, 1);
      assert.equal(mails[0].to, "support@shoproom.example");
      assert.equal(mails[0].replyTo, "asha@example.test");
      assert.match(mails[0].subject, /Pricing question/);
      assert.match(mails[0].text, /two shops/);
    });

    it("escapes HTML so a message can't inject markup into the support inbox", async () => {
      await contact({ ...GOOD, name: "<b>Eve</b>", message: "<script>alert(1)</script> hello there" });
      assert.ok(!mails[0].html.includes("<script>"));
      assert.ok(!mails[0].html.includes("<b>Eve"));
      assert.match(mails[0].html, /&lt;script&gt;/);
    });

    it("refuses names and subjects that could smuggle extra mail headers", async () => {
      for (const field of ["name", "subject"]) {
        for (const value of ["a\r\nBcc: victim@example.test", "line\nbreak", "tab\there"]) {
          assert.equal((await contactFromNewClient({ ...GOOD, [field]: value })).status, 400, `${field}: ${JSON.stringify(value)}`);
        }
      }
      assert.equal(mails.length, 0);
    });

    it("rejects missing, malformed and oversized input", async () => {
      const bad: unknown[] = [
        {},
        "text",
        { ...GOOD, email: "not-an-email" },
        { ...GOOD, name: "" },
        { ...GOOD, name: "x".repeat(101) },
        { ...GOOD, subject: "x".repeat(151) },
        { ...GOOD, message: "short" },
        { ...GOOD, message: "x".repeat(4001) },
        { ...GOOD, email: ["a@b.test"] },
      ];
      for (const body of bad) assert.equal((await contactFromNewClient(body)).status, 400, JSON.stringify(body).slice(0, 50));
      assert.equal(mails.length, 0);
    });

    it("says so instead of pretending, when no inbox is configured or mail is down", async () => {
      failSending = true;
      const down = await contact(GOOD);
      assert.equal(down.status, 502);
      assert.ok(!/smtp/i.test(JSON.stringify(down.json)), "internal error text is not leaked");

      const saved = { contact: process.env.CONTACT_EMAIL, user: process.env.SMTP_USER };
      delete process.env.CONTACT_EMAIL;
      delete process.env.SMTP_USER;
      try {
        assert.equal((await contact(GOOD)).status, 503);
      } finally {
        if (saved.contact) process.env.CONTACT_EMAIL = saved.contact;
        if (saved.user) process.env.SMTP_USER = saved.user;
      }
    });

    it("is rate limited per client", async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 7; i += 1) statuses.push((await contact(GOOD)).status);
      assert.deepEqual(statuses, [202, 202, 202, 202, 202, 429, 429]);
      t.newClientIp();
      assert.equal((await contact(GOOD)).status, 202, "another client is unaffected");
    });
  });

  describe("newsletter", () => {
    it("stores the address lower-cased, and subscribing again changes nothing", async () => {
      const first = await subscribe({ email: " Reader@Example.TEST " });
      const second = await subscribe({ email: "reader@example.test" });
      assert.equal(first.status, 201, JSON.stringify(first.json));
      assert.deepEqual(second.json, first.json, "no hint whether the address was already there");
      assert.equal(second.status, 201);
      const rows = await t.prisma.newsletterSubscriber.findMany();
      assert.deepEqual(rows.map((r) => r.email), ["reader@example.test"]);
    });

    it("rejects invalid input without storing anything", async () => {
      for (const body of [{}, { email: "nope" }, { email: "x".repeat(250) + "@a.test" }, { email: 5 }, "text"]) {
        assert.equal((await subscribe(body)).status, 400, JSON.stringify(body).slice(0, 40));
      }
      assert.equal(await t.prisma.newsletterSubscriber.count(), 0);
    });

    it("is rate limited per client", async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 12; i += 1) statuses.push((await subscribe({ email: `r${i}@example.test` })).status);
      assert.equal(statuses.filter((s) => s === 201).length, 10);
      assert.equal(statuses.at(-1), 429);
      assert.equal(await t.prisma.newsletterSubscriber.count(), 10);
    });
  });
});
