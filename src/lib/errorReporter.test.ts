import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { startReceiver } from "../test/receiver.js";
import { buildEnvelope, parseDsn, reportError, resetErrorReporter } from "./errorReporter.js";

let receiver: Awaited<ReturnType<typeof startReceiver>>;

beforeEach(async () => {
  resetErrorReporter();
  receiver = await startReceiver();
});
afterEach(async () => {
  delete process.env.SENTRY_DSN;
  await receiver.close();
});

describe("parseDsn", () => {
  it("derives the envelope endpoint and auth header", () => {
    const parsed = parseDsn("https://abc123@o1.ingest.sentry.io/4507");
    assert.equal(parsed?.endpoint, "https://o1.ingest.sentry.io/api/4507/envelope/");
    assert.match(parsed?.authHeader ?? "", /sentry_key=abc123/);
  });

  it("rejects malformed DSNs", () => {
    for (const bad of ["", "not a url", "https://host/4507", "ftp://k@host/1", "https://k@host/"]) {
      assert.equal(parseDsn(bad), null, bad);
    }
  });
});

describe("buildEnvelope", () => {
  it("produces header, item header and event lines with only the intended fields", () => {
    const err = Object.assign(new Error("db exploded"), { config: { password: "hunter2" }, code: "P1001" });
    const lines = buildEnvelope(err, { message: "Dispatch failed", requestId: "req-1234abcd", route: "/api/x" }).split("\n");
    assert.equal(lines.length, 3);
    assert.ok(JSON.parse(lines[0]).event_id);
    assert.deepEqual(JSON.parse(lines[1]), { type: "event" });
    const event = JSON.parse(lines[2]);
    assert.equal(event.exception.values[0].type, "Error");
    assert.equal(event.exception.values[0].value, "db exploded");
    assert.equal(event.tags.request_id, "req-1234abcd");
    assert.equal(event.tags.route, "/api/x");
    assert.ok(!lines[2].includes("hunter2"), "arbitrary error properties are never sent");
  });

  it("truncates huge messages", () => {
    const event = JSON.parse(buildEnvelope(new Error("x".repeat(10_000)), {}).split("\n")[2]);
    assert.ok(event.exception.values[0].value.length <= 500);
  });
});

describe("reportError", () => {
  it("posts an envelope to the project endpoint with the key in the auth header", async () => {
    process.env.SENTRY_DSN = `http://publickey@127.0.0.1:${receiver.port}/42`;
    reportError(new Error("kaboom"), { requestId: "req-aaaa1111" });
    const [request] = await receiver.waitFor(1);
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/api/42/envelope/");
    assert.match(String(request.headers["x-sentry-auth"]), /sentry_key=publickey/);
    assert.equal(request.headers["content-type"], "application/x-sentry-envelope");
    assert.match(request.body, /kaboom/);
  });

  it("does nothing without a DSN", async () => {
    reportError(new Error("quiet"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(receiver.requests.length, 0);
  });

  it("never throws, even when the collector is unreachable or the DSN is bad", async () => {
    process.env.SENTRY_DSN = "http://k@127.0.0.1:1/1";
    assert.doesNotThrow(() => reportError(new Error("nobody listening")));
    process.env.SENTRY_DSN = "garbage";
    assert.doesNotThrow(() => reportError(new Error("bad dsn")));
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  it("caps reports per minute so an error storm cannot flood the collector", async () => {
    process.env.SENTRY_DSN = `http://k@127.0.0.1:${receiver.port}/1`;
    for (let i = 0; i < 100; i += 1) reportError(new Error(`storm ${i}`));
    await receiver.waitFor(30);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(receiver.requests.length, 30);
  });
});
