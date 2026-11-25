import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allowedImageHosts, isAllowedImageUrl, isSafeLinkUrl } from "./safeUrl.js";

describe("isSafeLinkUrl", () => {
  it("accepts public http(s) links", () => {
    assert.equal(isSafeLinkUrl("https://shop.example.com/sale?x=1#top"), true);
    assert.equal(isSafeLinkUrl("http://shop.example.com"), true);
  });

  it("rejects script, data, file and app-intent schemes", () => {
    for (const url of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "intent://scan/#Intent;scheme=zxing;end",
      "ftp://shop.example.com/file",
    ]) {
      assert.equal(isSafeLinkUrl(url), false, url);
    }
  });

  it("rejects credentials, odd ports and internal hosts", () => {
    for (const url of [
      "https://paypal.com@evil.example.com/",
      "https://user:pass@shop.example.com/",
      "https://shop.example.com:8443/",
      "http://localhost/admin",
      "http://127.0.0.1/",
      "http://10.0.0.5/",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/",
      "http://intranet/",
      "https://printer.local/",
      "https://db.internal/",
    ]) {
      assert.equal(isSafeLinkUrl(url), false, url);
    }
  });

  it("rejects empty, malformed and oversized input", () => {
    assert.equal(isSafeLinkUrl(""), false);
    assert.equal(isSafeLinkUrl("not a url"), false);
    assert.equal(isSafeLinkUrl(`https://shop.example.com/${"a".repeat(2100)}`), false);
  });
});

describe("isAllowedImageUrl", () => {
  it("accepts https images from the trusted hosts", () => {
    assert.equal(isAllowedImageUrl("https://res.cloudinary.com/demo/image/upload/a.jpg"), true);
    assert.equal(isAllowedImageUrl("https://images.pexels.com/photos/1/a.jpeg"), true);
    assert.equal(isAllowedImageUrl("https://images.unsplash.com/photo-1"), true);
  });

  it("rejects other hosts, plain http and look-alike domains", () => {
    assert.equal(isAllowedImageUrl("https://tracker.example.com/pixel.png"), false);
    assert.equal(isAllowedImageUrl("http://res.cloudinary.com/demo/a.jpg"), false);
    assert.equal(isAllowedImageUrl("https://res.cloudinary.com.evil.example/a.jpg"), false);
    assert.equal(isAllowedImageUrl("https://evilres.cloudinary.com/a.jpg"), false);
    assert.equal(isAllowedImageUrl("https://res.cloudinary.com@evil.example/a.jpg"), false);
  });

  it("honours an explicit host list", () => {
    assert.equal(isAllowedImageUrl("https://cdn.example.com/a.png", ["cdn.example.com"]), true);
    assert.equal(isAllowedImageUrl("https://res.cloudinary.com/a.png", ["cdn.example.com"]), false);
  });
});

describe("allowedImageHosts", () => {
  it("falls back to the built-in list and can be overridden", () => {
    assert.ok(allowedImageHosts({}).includes("res.cloudinary.com"));
    assert.deepEqual(allowedImageHosts({ NOTIFICATION_IMAGE_HOSTS: " A.example.com ,b.example.com" }), [
      "a.example.com",
      "b.example.com",
    ]);
  });
});
