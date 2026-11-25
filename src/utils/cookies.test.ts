import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCookies, serializeCookie } from "./cookies.js";

describe("parseCookies", () => {
  it("reads name/value pairs", () => {
    assert.deepEqual(parseCookies("a=1; b=two; sr_customer=eyJ.abc.def"), { a: "1", b: "two", sr_customer: "eyJ.abc.def" });
  });

  it("copes with nothing, spacing, quotes and encoding", () => {
    assert.deepEqual(parseCookies(undefined), {});
    assert.deepEqual(parseCookies(""), {});
    assert.deepEqual(parseCookies("  a = 1 ;b=%20x;c=\"q\""), { a: "1", b: " x", c: "q" });
    assert.deepEqual(parseCookies("a=%E0%A4%A"), { a: "%E0%A4%A" }, "a bad escape is kept as it came");
  });

  it("skips pieces without a name, and lets the first copy of a repeated name win", () => {
    assert.deepEqual(parseCookies("=x; ; novalue; a=1; a=2"), { a: "1" });
  });

  it("does not let a cookie called __proto__ change prototypes", () => {
    const cookies = parseCookies("__proto__=evil; constructor=also");
    assert.equal(Object.getPrototypeOf(cookies), Object.prototype);
    assert.equal(({} as Record<string, unknown>).evil, undefined);
  });
});

describe("serializeCookie", () => {
  it("writes the attributes a session cookie needs", () => {
    assert.equal(
      serializeCookie("sr_customer", "abc.def", { maxAgeSeconds: 604_800, httpOnly: true, secure: true, sameSite: "lax" }),
      "sr_customer=abc.def; Path=/; Max-Age=604800; HttpOnly; Secure; SameSite=Lax",
    );
  });

  it("omits Secure and HttpOnly unless asked, and supports a domain and SameSite=None", () => {
    assert.equal(serializeCookie("x", "1", { maxAgeSeconds: 60 }), "x=1; Path=/; Max-Age=60; SameSite=Lax");
    assert.equal(serializeCookie("x", "1", { maxAgeSeconds: 60, domain: ".example.com", sameSite: "none", secure: true }), "x=1; Path=/; Domain=.example.com; Max-Age=60; Secure; SameSite=None");
  });

  it("deletes with Max-Age 0 and an expiry in the past", () => {
    const cookie = serializeCookie("x", "", { maxAgeSeconds: 0, httpOnly: true });
    assert.match(cookie, /Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly/);
  });

  it("encodes values and refuses anything that could add an attribute or header", () => {
    assert.equal(serializeCookie("x", "a b;c", { maxAgeSeconds: 1 }).split(";")[0], "x=a%20b%3Bc");
    for (const name of ["", "a b", "a;b", "a\r\nSet-Cookie: x=1", "a=b"]) assert.throws(() => serializeCookie(name, "1", { maxAgeSeconds: 1 }), /name/, JSON.stringify(name));
    for (const domain of ["evil.com; Path=/x", "a b", "-bad.com", "x.com\r\nX: y"]) assert.throws(() => serializeCookie("x", "1", { maxAgeSeconds: 1, domain }), /domain/, JSON.stringify(domain));
  });
});
