# Observability

What the API emits, how to read it, and what to configure. Nothing here needs a new dependency; every piece degrades to "off" when its setting is empty.

## Logs

One JSON object per line. Info and debug go to stdout, warnings and errors to stderr; ship both.

```json
{"time":"2026-11-02T06:09:55.428Z","level":"warn","msg":"Socket reaction failed","requestId":"ws-23f6aa91-…","roomId":"…","err":{"name":"Error","message":"Message not found","stack":"…"}}
```

- `LOG_LEVEL`: `debug | info | warn | error | silent` (default `info`).
- Every line inside a request, socket event or background job carries `requestId`. HTTP requests use the caller's `X-Request-Id` when it looks like an id (8-64 of `A-Za-z0-9._-`), otherwise a new UUID; it is returned in the `X-Request-Id` response header. Socket events get `ws-<uuid>`, scheduler work `job-schedule-<uuid>` / `job-tick-<uuid>`. To follow a bug report, search the logs for the id the client saw.
- Access log: one `request` line per response with `method`, `route` (the pattern, e.g. `/api/rooms/:roomId/messages`, never the raw URL), `status`, `durationMs`. 5xx are `error`. Health probes and scrapes are `debug`.
- Fields whose names suggest secrets or personal data (`password`, `token`, `authorization`, `cookie`, `otp`, `email`, `phone`, `signature`, `dsn`, `api key`) are replaced by `[redacted]` before writing. Error objects are reduced to name, code, a truncated message and an 8-line stack.
- Failures the caller caused (wrong OTP, plan limit) are logged as `warn`; real faults are `error` and are sent to the error tracker.

## Error tracking

Set `SENTRY_DSN` (any Sentry-compatible project DSN). Every `logger.error` carrying an `Error`, plus uncaught exceptions, is posted to the project's envelope endpoint: error type, truncated message, short stack, correlation id, environment, release. No request bodies, headers or user data. Capped at 30 reports per minute; failures to deliver are logged and never affect requests. `RELEASE` (or the package version) tags events.

Web app errors: the front end reports uncaught errors, unhandled promise rejections and error-boundary hits to `POST /api/client-errors` (20 per minute per IP, tiny schema). They appear as `Client error` warnings and in the `client_errors_total` counter. They are not forwarded to Sentry; search the logs or alert on the counter.

The Sentry delivery path is verified against a local receiver in tests; it has not been exercised against a live Sentry project, so check one test event after setting the DSN.

## Health checks

| Endpoint | Meaning | Use for |
| --- | --- | --- |
| `GET /healthz` | process is serving HTTP | container liveness probe |
| `GET /readyz` | also reaches the database (2 s timeout); 503 when not | **external uptime monitor**, load balancer readiness |
| `GET /metrics` | Prometheus metrics; needs `Authorization: Bearer $METRICS_TOKEN` | scraper |

None of them is rate limited. Set up the uptime monitor against `https://<api-host>/readyz` with a 1-minute interval and alerts to a channel a human watches (UptimeRobot, Better Stack, Pingdom or a cloud provider's check all work).

## Metrics

| Metric | Labels | Question it answers |
| --- | --- | --- |
| `http_requests_total` | method, route, status (2xx..5xx) | error rate, traffic per route |
| `http_request_duration_seconds` (histogram) | method, route | p95 latency: `histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[5m])))` |
| `socket_connections` | | live chat connections |
| `notification_sends_total` | status (SENT, FAILED) | send success rate |
| `notification_device_results_total` | result (success, failure) | per-device push success |
| `fcm_tokens_invalidated_total` | | how many dead tokens FCM reports |
| `scheduler_runs_total` | result (sent, missed, limit_reached) | scheduled-send health |
| `payment_verifications_total` | outcome (success, failure, refunded, refund_pending) | payment success rate |
| `payment_refunds_total` | result (refunded, failed) | payments that could not be honoured, and whether the refund went through |
| `razorpay_webhook_events_total` | result (fulfilled, duplicate, refunded, refund_pending, unknown_order, mismatch, payment_failed, ignored, invalid_signature, invalid_body, error) | webhook health |
| `client_errors_total` | kind | front-end error volume |
| `alerts_fired_total` | kind | how often the built-in alerts fire |
| `process_uptime_seconds`, `process_resident_memory_bytes` | | restarts, memory |

Counters live in each process's memory and reset on restart; Prometheus handles that. With several API instances, scrape each instance (labels add up on the Prometheus side).

## Alerts

Two layers, so a small deployment is covered without extra infrastructure:

1. **Built in.** Set `ALERT_WEBHOOK_URL` to a Slack/Discord/Teams-style incoming webhook (it receives `{"text": "..."}`). The API alerts, at most once per 30 minutes per kind, when:

   | Kind | Condition |
   | --- | --- |
   | `elevated_5xx` | at least 5% of the last 5 minutes' requests (min. 50 requests) were 5xx |
   | `send_failure_spike` | at least 50% of push deliveries failed over 15 minutes (min. 20 devices) |
   | `payment_failures` | 3 payment verifications failed in 10 minutes |
   | `webhook_signature_failures` | 3 Razorpay webhooks failed their signature check in 10 minutes |

   Alerts are always also written to the log (`"alert": true`), whether or not a webhook is set.
2. **Prometheus rules** in `prometheus-alerts.yml` for the same signals plus "API down", "database not ready" and "no sends succeeded", for teams that run Prometheus/Alertmanager.

Tune thresholds in `src/services/alerting.service.ts` (`THRESHOLDS`). The in-process counters are per instance; a rule that must span instances belongs in Prometheus.

## Settings

| Variable | Purpose |
| --- | --- |
| `LOG_LEVEL` | log verbosity |
| `SENTRY_DSN` | error tracking (optional) |
| `ALERT_WEBHOOK_URL` | built-in alert delivery (optional) |
| `METRICS_TOKEN` | enables `/metrics` (without it the endpoint answers 401) |
| `RELEASE` | version tag on error reports |
