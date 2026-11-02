/**
 * lib/metrics.ts — A small in-process metrics registry that renders the
 * Prometheus text exposition format (served at GET /metrics).
 *
 * Counters, gauges and histograms are per process. Label values must come from
 * bounded sets (route patterns, status classes, outcomes), never from user
 * input; as a backstop each metric keeps at most MAX_SERIES label combinations
 * and folds the rest into one "other" series so a bug can't exhaust memory.
 */

type Labels = Record<string, string>;

const MAX_SERIES = 500;

function labelKey(labels: Labels): string {
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}="${labels[k].replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`)
    .join(",");
}

abstract class Metric {
  constructor(
    readonly name: string,
    readonly help: string,
    readonly type: "counter" | "gauge" | "histogram",
  ) {}
  abstract render(): string[];
  abstract reset(): void;
  protected header(): string[] {
    return [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} ${this.type}`];
  }
}

function series<T>(map: Map<string, T>, labels: Labels, create: () => T): T {
  const key = labelKey(labels);
  let found = map.get(key);
  if (!found) {
    const overflowKey = 'overflow="other"';
    if (map.size >= MAX_SERIES) {
      found = map.get(overflowKey) ?? create();
      map.set(overflowKey, found);
      return found;
    }
    found = create();
    map.set(key, found);
  }
  return found;
}

export class Counter extends Metric {
  private values = new Map<string, { value: number }>();
  constructor(name: string, help: string) {
    super(name, help, "counter");
  }
  inc(labels: Labels = {}, amount = 1): void {
    series(this.values, labels, () => ({ value: 0 })).value += amount;
  }
  get(labels: Labels = {}): number {
    return this.values.get(labelKey(labels))?.value ?? 0;
  }
  render(): string[] {
    const lines = this.header();
    for (const [key, { value }] of this.values) lines.push(`${this.name}${key ? `{${key}}` : ""} ${value}`);
    return lines;
  }
  reset(): void {
    this.values.clear();
  }
}

export class Gauge extends Metric {
  private values = new Map<string, { value: number }>();
  constructor(name: string, help: string) {
    super(name, help, "gauge");
  }
  set(value: number, labels: Labels = {}): void {
    series(this.values, labels, () => ({ value: 0 })).value = value;
  }
  inc(labels: Labels = {}, amount = 1): void {
    series(this.values, labels, () => ({ value: 0 })).value += amount;
  }
  dec(labels: Labels = {}, amount = 1): void {
    this.inc(labels, -amount);
  }
  get(labels: Labels = {}): number {
    return this.values.get(labelKey(labels))?.value ?? 0;
  }
  render(): string[] {
    const lines = this.header();
    for (const [key, { value }] of this.values) lines.push(`${this.name}${key ? `{${key}}` : ""} ${value}`);
    return lines;
  }
  reset(): void {
    this.values.clear();
  }
}

interface HistogramSeries {
  counts: number[];
  sum: number;
  count: number;
}

export class Histogram extends Metric {
  private values = new Map<string, HistogramSeries>();
  constructor(
    name: string,
    help: string,
    private readonly buckets: number[],
  ) {
    super(name, help, "histogram");
  }
  observe(value: number, labels: Labels = {}): void {
    const s = series(this.values, labels, () => ({ counts: this.buckets.map(() => 0), sum: 0, count: 0 }));
    this.buckets.forEach((upper, i) => {
      if (value <= upper) s.counts[i] += 1;
    });
    s.sum += value;
    s.count += 1;
  }
  render(): string[] {
    const lines = this.header();
    for (const [key, s] of this.values) {
      const prefix = key ? `${key},` : "";
      this.buckets.forEach((upper, i) => lines.push(`${this.name}_bucket{${prefix}le="${upper}"} ${s.counts[i]}`));
      lines.push(`${this.name}_bucket{${prefix}le="+Inf"} ${s.count}`);
      lines.push(`${this.name}_sum${key ? `{${key}}` : ""} ${s.sum}`);
      lines.push(`${this.name}_count${key ? `{${key}}` : ""} ${s.count}`);
    }
    return lines;
  }
  reset(): void {
    this.values.clear();
  }
}

const registered: Metric[] = [];
function register<T extends Metric>(metric: T): T {
  registered.push(metric);
  return metric;
}

export function renderMetrics(): string {
  const processLines = [
    "# HELP process_uptime_seconds Seconds since the process started.",
    "# TYPE process_uptime_seconds gauge",
    `process_uptime_seconds ${Math.round(process.uptime())}`,
    "# HELP process_resident_memory_bytes Resident set size.",
    "# TYPE process_resident_memory_bytes gauge",
    `process_resident_memory_bytes ${process.memoryUsage().rss}`,
  ];
  return [...registered.flatMap((m) => m.render()), ...processLines].join("\n") + "\n";
}

export function resetMetrics(): void {
  registered.forEach((m) => m.reset());
}

// ── Product and platform signals ──────────────────────────────────────────────

export const httpRequests = register(
  new Counter("http_requests_total", "HTTP requests by method, route pattern and status class."),
);
export const httpDuration = register(
  new Histogram("http_request_duration_seconds", "HTTP request latency.", [
    0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
  ]),
);
export const socketConnections = register(new Gauge("socket_connections", "Open Socket.IO connections."));

export const notificationSends = register(
  new Counter("notification_sends_total", "Notification sends by final status (SENT, FAILED)."),
);
export const notificationDevices = register(
  new Counter("notification_device_results_total", "Per-device push results (success, failure)."),
);
export const fcmTokensInvalidated = register(
  new Counter("fcm_tokens_invalidated_total", "Device tokens removed because FCM reported them dead."),
);
export const schedulerRuns = register(
  new Counter("scheduler_runs_total", "Scheduled-send occurrences by result (sent, missed, limit_reached)."),
);

export const paymentVerifications = register(
  new Counter("payment_verifications_total", "Razorpay payment verifications by outcome (success, failure)."),
);
export const razorpayWebhooks = register(
  new Counter("razorpay_webhook_events_total", "Razorpay webhook deliveries by result."),
);

export const clientErrors = register(new Counter("client_errors_total", "Errors reported by the web app."));
export const alertsFired = register(new Counter("alerts_fired_total", "Alerts raised by kind."));
