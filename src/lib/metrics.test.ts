import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { Counter, Gauge, Histogram, renderMetrics, resetMetrics, httpRequests, httpDuration } from "./metrics.js";

describe("metrics", () => {
  beforeEach(() => resetMetrics());

  it("counts per label set and renders Prometheus text", () => {
    const c = new Counter("demo_total", "A demo.");
    c.inc({ result: "ok" });
    c.inc({ result: "ok" }, 2);
    c.inc({ result: "bad" });
    assert.equal(c.get({ result: "ok" }), 3);
    const text = c.render().join("\n");
    assert.match(text, /# HELP demo_total A demo\./);
    assert.match(text, /# TYPE demo_total counter/);
    assert.match(text, /demo_total\{result="ok"\} 3/);
    assert.match(text, /demo_total\{result="bad"\} 1/);
  });

  it("orders label names so equal label sets share a series", () => {
    const c = new Counter("order_total", "x");
    c.inc({ a: "1", b: "2" });
    c.inc({ b: "2", a: "1" });
    assert.equal(c.get({ a: "1", b: "2" }), 2);
  });

  it("escapes label values", () => {
    const c = new Counter("escape_total", "x");
    c.inc({ route: 'a"b\\c\nd' });
    assert.match(c.render().join("\n"), /route="a\\"b\\\\c\\nd"/);
  });

  it("gauges go up and down", () => {
    const g = new Gauge("open", "x");
    g.inc();
    g.inc();
    g.dec();
    assert.equal(g.get(), 1);
    g.set(7);
    assert.equal(g.get(), 7);
  });

  it("histograms keep cumulative buckets, sum and count", () => {
    const h = new Histogram("lat_seconds", "x", [0.1, 1]);
    h.observe(0.05, { route: "/a" });
    h.observe(0.5, { route: "/a" });
    h.observe(5, { route: "/a" });
    const text = h.render().join("\n");
    assert.match(text, /lat_seconds_bucket\{route="\/a",le="0.1"\} 1/);
    assert.match(text, /lat_seconds_bucket\{route="\/a",le="1"\} 2/);
    assert.match(text, /lat_seconds_bucket\{route="\/a",le="\+Inf"\} 3/);
    assert.match(text, /lat_seconds_count\{route="\/a"\} 3/);
    assert.match(text, /lat_seconds_sum\{route="\/a"\} 5\.55/);
  });

  it("caps the number of label combinations so a bug cannot exhaust memory", () => {
    const c = new Counter("cardinality_total", "x");
    for (let i = 0; i < 5_000; i += 1) c.inc({ id: String(i) });
    assert.ok(c.render().length <= 503, `rendered ${c.render().length} lines`);
    assert.match(c.render().join("\n"), /overflow="other"/);
  });

  it("exposes the registered product signals and process stats", () => {
    httpRequests.inc({ method: "GET", route: "/x", status: "2xx" });
    httpDuration.observe(0.02, { method: "GET", route: "/x" });
    const text = renderMetrics();
    for (const name of [
      "http_requests_total",
      "http_request_duration_seconds_bucket",
      "socket_connections",
      "notification_sends_total",
      "fcm_tokens_invalidated_total",
      "payment_verifications_total",
      "razorpay_webhook_events_total",
      "process_uptime_seconds",
    ]) {
      assert.ok(text.includes(name) || name === "socket_connections", name);
    }
    assert.match(text, /# TYPE socket_connections gauge/);
    assert.ok(text.endsWith("\n"));
  });
});
