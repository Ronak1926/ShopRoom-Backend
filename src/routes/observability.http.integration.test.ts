import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { createCustomer, createShop, integrationConfigured, resetDatabase } from "../test/integration.js";
import { startTestApp, type TestApp } from "../test/http.js";
import { setLogSink } from "../lib/logger.js";
import { resetMetrics } from "../lib/metrics.js";
import { resetAlerting } from "../services/alerting.service.js";

const enabled = integrationConfigured();

interface LogLine {
  level: string;
  [key: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- parsed log JSON
}

describe("observability over HTTP", { skip: !enabled }, () => {
  let t: TestApp;
  let logs: LogLine[];
  let restores: Array<() => void> = [];

  /** Replaces a method on an object (Prisma's client is a proxy, so node:test's mock.method can't). */
  function breakMethod(target: any, name: string, impl: () => unknown): void { // eslint-disable-line @typescript-eslint/no-explicit-any
    const original = target[name];
    target[name] = impl;
    restores.push(() => {
      target[name] = original;
    });
  }
  const restoreAll = () => {
    restores.forEach((restore) => restore());
    restores = [];
  };

  before(async () => {
    t = await startTestApp();
  });
  after(() => t.close());
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    t.clearSessionCache();
    t.newClientIp();
    resetMetrics();
    resetAlerting();
    logs = [];
    process.env.LOG_LEVEL = "debug";
    setLogSink((line, level) => logs.push({ ...JSON.parse(line), level }));
  });
  afterEach(() => {
    setLogSink(null);
    process.env.LOG_LEVEL = "silent";
    delete process.env.METRICS_TOKEN;
    restoreAll();
  });

  /** The access log is written when the response finishes, which can be just after the client has read it. */
  async function accessLogs(expected = 1): Promise<LogLine[]> {
    for (let i = 0; i < 100 && logs.filter((l) => l.msg === "request").length < expected; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return logs.filter((l) => l.msg === "request");
  }

  async function scrape(): Promise<string> {
    process.env.METRICS_TOKEN = "scrape-token-123";
    const res = await t.call("GET", "/metrics", { headers: { Authorization: "Bearer scrape-token-123" } });
    assert.equal(res.status, 200);
    return String(res.json);
  }

  describe("correlation ids", () => {
    it("echoes a caller's id and stamps it on the access log", async () => {
      const res = await t.call("GET", "/api/customers/me", { headers: { "X-Request-Id": "trace-1234-abcd" } });
      assert.equal(res.headers.get("x-request-id"), "trace-1234-abcd");
      const [line] = await accessLogs();
      assert.equal(line.requestId, "trace-1234-abcd");
      assert.equal(line.method, "GET");
      assert.equal(line.status, 401);
      assert.equal(line.route, "/api/customers/me");
      assert.equal(typeof line.durationMs, "number");
    });

    it("generates an id when none is sent and replaces unsafe ones", async () => {
      const generated = await t.call("GET", "/healthz");
      assert.match(generated.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/);

      for (const hostile of ["x", "has spaces and \t tab", "<script>alert(1)</script>", "a".repeat(200)]) {
        const res = await t.call("GET", "/api/customers/me", { headers: { "X-Request-Id": hostile } });
        const echoed = res.headers.get("x-request-id") ?? "";
        assert.notEqual(echoed, hostile);
        assert.match(echoed, /^[0-9a-f-]{36}$/);
      }
    });

    it("gives every log line of a failing request the same id as the response header", async () => {
      const { customerId } = await createCustomer(t.prisma);
      const token = t.customerToken(customerId);
      t.clearSessionCache();
      breakMethod(t.prisma.customer, "findUnique", async () => {
        throw new Error("connect ECONNREFUSED db.internal:5432 password=hunter2");
      });

      const res = await t.call("GET", "/api/customers/me", { token });
      restoreAll();
      await accessLogs();

      assert.equal(res.status, 500);
      assert.deepEqual(res.json, { message: "Something went wrong. Please try again." });
      const id = res.headers.get("x-request-id");
      const related = logs.filter((l) => l.requestId === id);
      assert.deepEqual(related.map((l) => l.msg).sort(), ["Unhandled error", "request"]);
      assert.equal(related.find((l) => l.msg === "request")?.level, "error");
      assert.ok(!JSON.stringify(res.json).includes("ECONNREFUSED"), "internals stay out of the response");
    });
  });

  describe("access logs and metrics", () => {
    it("record the route pattern, never the raw URL, query string or credentials", async () => {
      const { roomId } = await createShop(t.prisma);
      await t.call("GET", `/api/rooms/${roomId}/messages?page=2&secret=abc`, {
        headers: { Authorization: "Bearer sensitive.jwt.value" },
      });
      const [line] = await accessLogs();
      assert.equal(line.route, "/api/rooms/:roomId/messages");
      const raw = JSON.stringify(logs);
      for (const leaked of [roomId, "secret=abc", "sensitive.jwt.value"]) {
        assert.ok(!raw.includes(leaked), `${leaked} must not be logged`);
      }

      const metrics = await scrape();
      assert.match(metrics, /http_requests_total\{method="GET",route="\/api\/rooms\/:roomId\/messages",status="4xx"\} 1/);
      assert.ok(!metrics.includes(roomId));
    });

    it("count unknown paths under one label so scanners cannot inflate the series", async () => {
      for (let i = 0; i < 25; i += 1) await t.call("GET", `/wp-admin/${i}.php`);
      const metrics = await scrape();
      assert.match(metrics, /route="unmatched",status="4xx"\} 25/);
      assert.ok(!metrics.includes("wp-admin"));
    });

    it("record latency as a histogram per route", async () => {
      await t.call("GET", "/healthz");
      const metrics = await scrape();
      assert.match(metrics, /http_request_duration_seconds_bucket\{method="GET",route="\/healthz",le="0.1"\} 1/);
      assert.match(metrics, /http_request_duration_seconds_count\{method="GET",route="\/healthz"\} 1/);
    });

    it("keep health checks out of the info log", async () => {
      process.env.LOG_LEVEL = "info";
      await t.call("GET", "/healthz");
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(logs.filter((l) => l.msg === "request").length, 0, "probes would drown the real traffic");
    });
  });

  describe("GET /metrics", () => {
    it("requires the scrape token, and answers the same way when it is not configured", async () => {
      const anonymous = await t.call("GET", "/metrics");
      assert.equal(anonymous.status, 401);

      delete process.env.METRICS_TOKEN;
      const disabled = await t.call("GET", "/metrics", { headers: { Authorization: "Bearer anything" } });
      assert.equal(disabled.status, 401);
      assert.deepEqual(disabled.json, anonymous.json);

      process.env.METRICS_TOKEN = "right-token";
      for (const bad of ["Bearer wrong-token", "Bearer ", "right-token", "Basic right-token"]) {
        assert.equal((await t.call("GET", "/metrics", { headers: { Authorization: bad } })).status, 401, bad);
      }
    });

    it("serves Prometheus text including the product signals", async () => {
      process.env.METRICS_TOKEN = "right-token";
      const res = await t.call("GET", "/metrics", { headers: { Authorization: "Bearer right-token" } });
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type") ?? "", /^text\/plain/);
      for (const name of ["socket_connections", "process_uptime_seconds", "# TYPE http_requests_total counter"]) {
        assert.ok(String(res.json).includes(name), name);
      }
    });

    it("does not count its own scrapes", async () => {
      await scrape();
      await scrape();
      const metrics = await scrape();
      assert.ok(!metrics.includes('route="/metrics"'));
    });
  });

  describe("health checks", () => {
    it("liveness answers without touching the database", async () => {
      const res = await t.call("GET", "/healthz");
      assert.equal(res.status, 200);
      assert.deepEqual(res.json, { status: "ok" });
    });

    it("readiness reports the database up, and 503 when it is not", async () => {
      assert.deepEqual((await t.call("GET", "/readyz")).json, { status: "ok", database: "up" });

      breakMethod(t.prisma, "$queryRaw", async () => {
        throw new Error("connection refused postgres://user:pass@db.internal/shoproom");
      });
      const down = await t.call("GET", "/readyz");
      assert.equal(down.status, 503);
      assert.deepEqual(down.json, { status: "unavailable", database: "down" });
      assert.ok(!JSON.stringify(down.json).includes("postgres://"));
    });

    it("are not throttled by the API rate limit", async () => {
      const statuses = new Set<number>();
      for (let i = 0; i < 350; i += 1) statuses.add((await t.call("GET", "/healthz", { ip: "172.30.0.9" })).status);
      assert.deepEqual([...statuses], [200]);
    });
  });

  describe("POST /api/client-errors", () => {
    const report = (body: unknown, ip?: string) => t.call("POST", "/api/client-errors", { body, ip });

    it("accepts a bounded report, logs it as data and counts it", async () => {
      const res = await report({ message: "x is not a function", stack: "at a (b.js:1)", path: "/customer/home", kind: "error" });
      assert.equal(res.status, 204);
      const line = logs.find((l) => l.msg === "Client error");
      assert.equal(line?.level, "warn");
      assert.equal(line?.clientMessage, "x is not a function");
      assert.equal(line?.path, "/customer/home");
      assert.match(await scrape(), /client_errors_total\{kind="error"\} 1/);
    });

    it("rejects malformed, oversized or unknown-kind reports", async () => {
      for (const body of [
        {},
        { message: 42 },
        { message: "x".repeat(301) },
        { message: "ok", stack: "x".repeat(2001) },
        { message: "ok", kind: "arbitrary" },
        "not an object",
      ]) {
        assert.equal((await report(body)).status, 400, JSON.stringify(body)?.slice(0, 60));
      }
      assert.equal(logs.filter((l) => l.msg === "Client error").length, 0);
    });

    it("cannot be used to forge log fields", async () => {
      await report({ message: "hi", level: "error", requestId: "forged", clientMessage: "forged" });
      const line = logs.find((l) => l.msg === "Client error");
      assert.equal(line?.level, "warn");
      assert.notEqual(line?.requestId, "forged");
      assert.equal(line?.clientMessage, "hi");
    });

    it("is rate limited per client", async () => {
      const ip = "172.31.5.5";
      const statuses: number[] = [];
      for (let i = 0; i < 22; i += 1) statuses.push((await report({ message: `e${i}` }, ip)).status);
      assert.equal(statuses.filter((s) => s === 204).length, 20);
      assert.deepEqual(statuses.slice(20), [429, 429]);
    });
  });
});
