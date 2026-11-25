import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { setLogSink } from "../lib/logger.js";
import { startReceiver } from "../test/receiver.js";
import {
  RollingCounter,
  THRESHOLDS,
  raiseAlert,
  recordHttpStatus,
  recordPaymentFailure,
  recordSendResult,
  recordWebhookFailure,
  resetAlerting,
} from "./alerting.service.js";

const MINUTE = 60_000;
let alerts: string[];
let receiver: Awaited<ReturnType<typeof startReceiver>>;

beforeEach(async () => {
  resetAlerting();
  alerts = [];
  setLogSink((line) => {
    const entry = JSON.parse(line);
    if (entry.alert) alerts.push(entry.kind);
  });
  receiver = await startReceiver();
  process.env.ALERT_WEBHOOK_URL = `${receiver.url}/hook`;
});
afterEach(async () => {
  setLogSink(null);
  delete process.env.ALERT_WEBHOOK_URL;
  await receiver.close();
});

describe("RollingCounter", () => {
  it("counts inside the window and forgets what fell out of it", () => {
    const c = new RollingCounter(60_000, 10_000);
    c.add(3, 0);
    c.add(2, 30_000);
    assert.equal(c.total(30_000), 5);
    assert.equal(c.total(65_000), 2, "the first bucket expired");
    assert.equal(c.total(200_000), 0);
  });
});

describe("server error alert", () => {
  it("fires when 5xx responses reach 5% of a meaningful volume", () => {
    const t0 = 10 * MINUTE;
    for (let i = 0; i < 47; i += 1) recordHttpStatus(200, t0);
    for (let i = 0; i < 2; i += 1) recordHttpStatus(500, t0);
    assert.deepEqual(alerts, [], "2 of 49 is below the volume and ratio thresholds");
    recordHttpStatus(503, t0);
    recordHttpStatus(502, t0);
    assert.deepEqual(alerts, ["elevated_5xx"]);
  });

  it("stays quiet for a handful of failures at low volume", () => {
    for (let i = 0; i < 10; i += 1) recordHttpStatus(500, 0);
    assert.ok(THRESHOLDS.serverErrorMinRequests > 10);
    assert.deepEqual(alerts, []);
  });

  it("ignores client errors", () => {
    for (let i = 0; i < 200; i += 1) recordHttpStatus(i % 2 ? 401 : 404, 0);
    assert.deepEqual(alerts, []);
  });

  it("alerts once per cooldown, then again after it", () => {
    const t0 = 20 * MINUTE;
    for (let i = 0; i < 100; i += 1) recordHttpStatus(500, t0);
    assert.deepEqual(alerts, ["elevated_5xx"], "100 failures raise one alert, not 50");
    for (let i = 0; i < 100; i += 1) recordHttpStatus(500, t0 + 31 * MINUTE);
    assert.deepEqual(alerts, ["elevated_5xx", "elevated_5xx"]);
  });
});

describe("push failure alert", () => {
  it("fires when most deliveries fail across enough devices", () => {
    recordSendResult(5, 10, 0);
    assert.deepEqual(alerts, [], "too few devices to judge");
    recordSendResult(0, 20, 1000);
    assert.deepEqual(alerts, ["send_failure_spike"]);
  });

  it("does not fire when failures are a minority", () => {
    recordSendResult(900, 100, 0);
    assert.deepEqual(alerts, []);
  });
});

describe("payment alerts", () => {
  it("fires after repeated payment verification failures", () => {
    recordPaymentFailure(0);
    recordPaymentFailure(1000);
    assert.deepEqual(alerts, []);
    recordPaymentFailure(2000);
    assert.deepEqual(alerts, ["payment_failures"]);
  });

  it("does not count failures spread over more than the window", () => {
    recordPaymentFailure(0);
    recordPaymentFailure(11 * MINUTE);
    recordPaymentFailure(22 * MINUTE);
    assert.deepEqual(alerts, []);
  });

  it("fires after repeated webhook signature failures", () => {
    for (let i = 0; i < THRESHOLDS.webhookFailures; i += 1) recordWebhookFailure(i * 1000);
    assert.deepEqual(alerts, ["webhook_signature_failures"]);
  });
});

describe("alert delivery", () => {
  it("posts a Slack-compatible message to ALERT_WEBHOOK_URL", async () => {
    assert.equal(await raiseAlert("payment_failures", "3 payment verifications failed"), true);
    const [request] = await receiver.waitFor(1);
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/hook");
    const body = JSON.parse(request.body);
    assert.match(body.text, /payment_failures/);
    assert.match(body.text, /3 payment verifications failed/);
  });

  it("does not post during the cooldown", async () => {
    await raiseAlert("elevated_5xx", "first", 0);
    await raiseAlert("elevated_5xx", "second", 5 * MINUTE);
    await receiver.waitFor(1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(receiver.requests.length, 1);
  });

  it("never throws when the webhook is down", async () => {
    process.env.ALERT_WEBHOOK_URL = "http://127.0.0.1:1/unreachable";
    assert.equal(await raiseAlert("send_failure_spike", "down", 0), true);
    assert.deepEqual(alerts, ["send_failure_spike"], "still logged");
  });

  it("works without a webhook configured", async () => {
    delete process.env.ALERT_WEBHOOK_URL;
    assert.equal(await raiseAlert("elevated_5xx", "log only"), true);
    assert.equal(receiver.requests.length, 0);
  });
});
