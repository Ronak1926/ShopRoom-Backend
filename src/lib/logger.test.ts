import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { isExpectedError, logger, redact, setLogSink } from "./logger.js";
import { acceptRequestId, currentRequestId, runWithRequestId, withNewRequestId } from "./requestContext.js";
import { NotificationError } from "../utils/notificationError.js";
import { VerifyError } from "./twilioVerify.js";

interface Captured {
  level: string;
  entry: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- parsed log JSON
}

let lines: Captured[];
let savedLevel: string | undefined;

beforeEach(() => {
  savedLevel = process.env.LOG_LEVEL;
  delete process.env.LOG_LEVEL;
  lines = [];
  setLogSink((line, level) => lines.push({ level, entry: JSON.parse(line) }));
});
afterEach(() => {
  setLogSink(null);
  if (savedLevel === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = savedLevel;
});

describe("logger", () => {
  it("writes one JSON object per call with time, level and message", () => {
    logger.info("hello", { port: 3001 });
    assert.equal(lines.length, 1);
    const { level, entry } = lines[0];
    assert.equal(level, "info");
    assert.equal(entry.msg, "hello");
    assert.equal(entry.port, 3001);
    assert.ok(!Number.isNaN(Date.parse(entry.time)));
  });

  it("honours LOG_LEVEL", () => {
    process.env.LOG_LEVEL = "warn";
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    assert.deepEqual(lines.map((l) => l.entry.msg), ["w", "e"]);
    process.env.LOG_LEVEL = "silent";
    lines.length = 0;
    logger.error("nothing");
    assert.equal(lines.length, 0);
  });

  it("stamps the current correlation id, and only inside a context", () => {
    logger.info("outside");
    runWithRequestId("req-abc12345", () => logger.info("inside"));
    assert.equal(lines[0].entry.requestId, undefined);
    assert.equal(lines[1].entry.requestId, "req-abc12345");
  });

  it("keeps the correlation id across awaits and timers", async () => {
    await runWithRequestId("req-async-0001", async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      await Promise.resolve();
      logger.info("later");
    });
    assert.equal(lines[0].entry.requestId, "req-async-0001");
  });

  it("gives concurrent units of work their own ids", async () => {
    await Promise.all(
      ["one", "two", "three"].map((name) =>
        withNewRequestId(name, async () => {
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
          logger.info(name);
          assert.ok(currentRequestId()?.startsWith(name));
        }),
      ),
    );
    for (const { entry } of lines) assert.ok(String(entry.requestId).startsWith(entry.msg));
  });

  it("redacts secrets and personal data, at any depth", () => {
    logger.info("login", {
      email: "a@b.co",
      password: "hunter2",
      nested: { token: "t", phoneNumber: "9876543210", authorization: "Bearer x", ok: "visible" },
      list: [{ otp: "123456", fine: 1 }],
      headers: { cookie: "session=1" },
      razorpaySignature: "sig",
    });
    const text = JSON.stringify(lines[0].entry);
    for (const secret of ["a@b.co", "hunter2", "9876543210", "Bearer x", "123456", "session=1", "sig"]) {
      assert.ok(!text.includes(secret), `${secret} leaked`);
    }
    assert.equal(lines[0].entry.nested.ok, "visible");
    assert.equal(lines[0].entry.list[0].fine, 1);
    assert.equal(lines[0].entry.email, "[redacted]");
  });

  it("truncates long strings and deep structures", () => {
    const deep = { a: { b: { c: { d: { e: "too deep" } } } } };
    assert.equal(JSON.stringify(redact(deep)).includes("too deep"), false);
    assert.ok((redact("x".repeat(5000)) as string).length < 600);
  });

  it("logs errors as name, code, message and a short stack, never the raw object", () => {
    const err = Object.assign(new Error("boom"), { code: "P2002", meta: { secret: "do-not-log" }, config: { password: "p" } });
    logger.error("failed", err);
    const { level, entry } = lines[0];
    assert.equal(level, "error");
    assert.equal(entry.err.name, "Error");
    assert.equal(entry.err.code, "P2002");
    assert.equal(entry.err.message, "boom");
    assert.ok(entry.err.stack.split("\n").length <= 8);
    assert.ok(!JSON.stringify(entry).includes("do-not-log"));
  });

  it("accepts a plain string as the detail", () => {
    logger.error("failed", "just text");
    assert.equal(lines[0].entry.err, "just text");
  });

  it("logs failures the caller caused as warnings, real faults as errors", () => {
    logger.error("user mistake", new VerifyError("Incorrect code"));
    logger.error("plan limit", NotificationError.tooManyRequests("limit"));
    logger.error("upstream down", NotificationError.badGateway("push service"));
    logger.error("bug", new TypeError("x is undefined"));
    assert.deepEqual(lines.map((l) => l.level), ["warn", "warn", "error", "error"]);
    assert.equal(isExpectedError(new VerifyError("x")), true);
    assert.equal(isExpectedError(new TypeError("x")), false);
    assert.equal(isExpectedError("string"), false);
  });
});

describe("request ids from outside", () => {
  it("are accepted only when they look like ids", () => {
    assert.equal(acceptRequestId("abc-12345_XYZ.9"), "abc-12345_XYZ.9");
    for (const bad of ["", "short", "has space in it", "line\nbreak-injection", "x".repeat(65), "<script>alert(1)</script>", undefined, 42, ["a"]]) {
      const id = acceptRequestId(bad);
      assert.notEqual(id, bad);
      assert.match(id, /^[0-9a-f-]{36}$/, `replaced ${JSON.stringify(bad)} with a UUID`);
    }
  });
});
