import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { button, codeBlock, escapeHtml, notice, renderEmail, siteUrl, textFooter } from "./emailLayout.js";

describe("email layout", () => {
  const saved: Record<string, string | undefined> = {};
  const KEYS = ["FRONTEND_BASE_URL", "INVOICE_SELLER_NAME", "INVOICE_SELLER_ADDRESS"] as const;

  beforeEach(() => {
    for (const key of KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    process.env.FRONTEND_BASE_URL = "https://app.example.test/";
  });

  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  const sample = (extra: Partial<Parameters<typeof renderEmail>[0]> = {}) =>
    renderEmail({ preheader: "Preview line", heading: "Hello", bodyHtml: "<p>Body</p>", reason: "You asked for this.", ...extra });

  it("links the policies and help from the footer, with no double slash", () => {
    const html = sample();
    for (const path of ["/privacy", "/terms", "/help", "/contact"]) assert.ok(html.includes(`href="https://app.example.test${path}"`), path);
    assert.equal(siteUrl("/x"), "https://app.example.test/x");
  });

  it("states why the person is getting the email and carries the preview text", () => {
    const html = sample();
    assert.ok(html.includes("You asked for this."));
    assert.ok(html.includes("Preview line"));
  });

  it("shows the business name and address only when they are configured", () => {
    assert.ok(!sample().includes("Registered office"));
    process.env.INVOICE_SELLER_NAME = "Acme Pvt Ltd";
    process.env.INVOICE_SELLER_ADDRESS = "1 Main Road, Ahmedabad";
    const html = sample();
    assert.ok(html.includes("Acme Pvt Ltd, 1 Main Road, Ahmedabad"));
  });

  it("escapes anything that could break out of the markup", () => {
    const html = sample({ heading: `<script>alert(1)</script>`, reason: `"quoted" & <b>` });
    assert.ok(!html.includes("<script>alert"));
    assert.ok(html.includes("&lt;script&gt;"));
    assert.ok(html.includes("&quot;quoted&quot; &amp; &lt;b&gt;"));
    assert.ok(!button("Go", `https://x.test/?a="b"`).includes(`"b"`));
    assert.ok(notice("T<", "x>").includes("T&lt;"));
    assert.equal(escapeHtml(`a&b<c>"`), "a&amp;b&lt;c&gt;&quot;");
  });

  it("keeps the code in its own element, directly followed by the closing tag", () => {
    assert.match(codeBlock("123456"), /(\d{6})<\/div>/);
  });

  it("gives the plain-text part the same footer links", () => {
    const text = textFooter("Because.");
    assert.ok(text.includes("Privacy Policy: https://app.example.test/privacy"));
    assert.ok(text.includes("Because."));
  });
});
