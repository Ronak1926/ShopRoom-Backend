/**
 * services/alerting.service.ts — Raises an alert for the three failure signals
 * that cost money or trust if nobody notices: payment/webhook failures, a spike
 * in server errors, and a spike in notification-send failures.
 *
 * Detection is a rolling window over the last few minutes. An alert is logged
 * at error level (alert: true) and, if ALERT_WEBHOOK_URL is set, POSTed as
 * `{ "text": "…" }` (Slack/Discord/Teams-compatible). Each kind alerts at most
 * once per cooldown so a sustained outage pages once, not every second.
 * Delivery failures are swallowed; alerting must never break a request.
 */

import axios from "axios";
import { alertsFired } from "../lib/metrics.js";
import { logger } from "../lib/logger.js";

/** Counts events in fixed buckets so old ones fall out of the window. */
export class RollingCounter {
  private buckets = new Map<number, number>();
  constructor(
    private readonly windowMs: number,
    private readonly bucketMs = 15_000,
  ) {}

  add(amount = 1, now = Date.now()): void {
    const bucket = Math.floor(now / this.bucketMs);
    this.buckets.set(bucket, (this.buckets.get(bucket) ?? 0) + amount);
    this.prune(now);
  }

  total(now = Date.now()): number {
    this.prune(now);
    let sum = 0;
    for (const count of this.buckets.values()) sum += count;
    return sum;
  }

  reset(): void {
    this.buckets.clear();
  }

  private prune(now: number): void {
    const oldest = Math.floor((now - this.windowMs) / this.bucketMs);
    for (const bucket of this.buckets.keys()) if (bucket <= oldest) this.buckets.delete(bucket);
  }
}

export type AlertKind = "elevated_5xx" | "send_failure_spike" | "payment_failures" | "webhook_signature_failures";

export const THRESHOLDS = {
  /** Alert when at least this share of requests in the window were 5xx… */
  serverErrorRatio: 0.05,
  /** …and there were at least this many requests (so one failed request at 3am isn't an incident). */
  serverErrorMinRequests: 50,
  sendFailureRatio: 0.5,
  sendMinDevices: 20,
  paymentFailures: 3,
  webhookFailures: 3,
};

const COOLDOWN_MS = 30 * 60_000;
const WEBHOOK_TIMEOUT_MS = 5000;

const requests = new RollingCounter(5 * 60_000);
const serverErrors = new RollingCounter(5 * 60_000);
const devicesTried = new RollingCounter(15 * 60_000);
const devicesFailed = new RollingCounter(15 * 60_000);
const paymentFailures = new RollingCounter(10 * 60_000);
const webhookFailures = new RollingCounter(10 * 60_000);
const lastAlertAt = new Map<AlertKind, number>();

export async function raiseAlert(kind: AlertKind, message: string, now = Date.now()): Promise<boolean> {
  const last = lastAlertAt.get(kind);
  if (last !== undefined && now - last < COOLDOWN_MS) return false;
  lastAlertAt.set(kind, now);

  alertsFired.inc({ kind });
  logger.warn(`ALERT ${kind}: ${message}`, { alert: true, kind });

  const url = process.env.ALERT_WEBHOOK_URL;
  if (url) {
    try {
      await axios.post(url, { text: `ShopRoom alert (${kind}): ${message}` }, { timeout: WEBHOOK_TIMEOUT_MS, maxRedirects: 0 });
    } catch (err) {
      logger.warn("Alert webhook not delivered", { kind }, err);
    }
  }
  return true;
}

export function recordHttpStatus(status: number, now = Date.now()): void {
  requests.add(1, now);
  if (status < 500) return;
  serverErrors.add(1, now);
  const total = requests.total(now);
  const failed = serverErrors.total(now);
  if (total >= THRESHOLDS.serverErrorMinRequests && failed / total >= THRESHOLDS.serverErrorRatio) {
    void raiseAlert("elevated_5xx", `${failed} of ${total} requests in the last 5 minutes returned 5xx`, now);
  }
}

export function recordSendResult(success: number, failure: number, now = Date.now()): void {
  devicesTried.add(success + failure, now);
  devicesFailed.add(failure, now);
  const tried = devicesTried.total(now);
  const failed = devicesFailed.total(now);
  if (tried >= THRESHOLDS.sendMinDevices && failed / tried >= THRESHOLDS.sendFailureRatio) {
    void raiseAlert("send_failure_spike", `${failed} of ${tried} push deliveries failed in the last 15 minutes`, now);
  }
}

export function recordPaymentFailure(now = Date.now()): void {
  paymentFailures.add(1, now);
  const count = paymentFailures.total(now);
  if (count >= THRESHOLDS.paymentFailures) {
    void raiseAlert("payment_failures", `${count} payment verifications failed in the last 10 minutes`, now);
  }
}

export function recordWebhookFailure(now = Date.now()): void {
  webhookFailures.add(1, now);
  const count = webhookFailures.total(now);
  if (count >= THRESHOLDS.webhookFailures) {
    void raiseAlert("webhook_signature_failures", `${count} Razorpay webhooks failed signature checks in the last 10 minutes`, now);
  }
}

/** Test hook: forget all windows and cooldowns. */
export function resetAlerting(): void {
  [requests, serverErrors, devicesTried, devicesFailed, paymentFailures, webhookFailures].forEach((c) => c.reset());
  lastAlertAt.clear();
}
