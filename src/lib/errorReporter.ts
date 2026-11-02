/**
 * lib/errorReporter.ts — Sends unexpected server errors to a Sentry-compatible
 * collector when SENTRY_DSN is set; does nothing otherwise.
 *
 * It posts a single error event to the project's envelope endpoint using axios
 * (already a dependency), so no SDK is needed. Only the error type, a truncated
 * message, a short stack and the correlation id are sent: no request bodies,
 * headers, cookies or user data. Reporting is fire-and-forget, capped per
 * minute, and can never throw into the caller.
 *
 * Do not log through logger.error from here (logger forwards errors to this
 * module); failures are written with logger.warn-style raw output instead.
 */

import axios from "axios";
import { randomUUID } from "node:crypto";

interface ParsedDsn {
  endpoint: string;
  authHeader: string;
}

export interface ErrorContext {
  message?: string;
  requestId?: string;
  route?: string;
}

const MAX_REPORTS_PER_MINUTE = 30;
const SEND_TIMEOUT_MS = 3000;
const MAX_MESSAGE = 500;
const MAX_STACK_LINES = 20;

let windowStart = 0;
let sentInWindow = 0;

export function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\/+/, "").split("/").pop();
    if (!url.username || !projectId || !/^https?:$/.test(url.protocol)) return null;
    return {
      endpoint: `${url.protocol}//${url.host}/api/${projectId}/envelope/`,
      authHeader: `Sentry sentry_version=7, sentry_client=shoproom-backend/1.0, sentry_key=${url.username}`,
    };
  } catch {
    return null;
  }
}

export function buildEnvelope(err: Error, context: ErrorContext, now = new Date()): string {
  const eventId = randomUUID().replace(/-/g, "");
  const event = {
    event_id: eventId,
    timestamp: now.getTime() / 1000,
    platform: "node",
    level: "error",
    environment: process.env.NODE_ENV ?? "development",
    release: process.env.RELEASE ?? process.env.npm_package_version,
    exception: { values: [{ type: err.name, value: err.message.slice(0, MAX_MESSAGE) }] },
    tags: { ...(context.requestId ? { request_id: context.requestId } : {}), ...(context.route ? { route: context.route } : {}) },
    extra: {
      context: context.message?.slice(0, MAX_MESSAGE),
      stack: err.stack?.split("\n").slice(0, MAX_STACK_LINES).join("\n"),
    },
  };
  return [JSON.stringify({ event_id: eventId, sent_at: now.toISOString() }), JSON.stringify({ type: "event" }), JSON.stringify(event)].join("\n");
}

function allowed(nowMs: number): boolean {
  if (nowMs - windowStart >= 60_000) {
    windowStart = nowMs;
    sentInWindow = 0;
  }
  sentInWindow += 1;
  return sentInWindow <= MAX_REPORTS_PER_MINUTE;
}

export function reportError(err: Error, context: ErrorContext = {}): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  const parsed = parseDsn(dsn);
  if (!parsed || !allowed(Date.now())) return;

  void axios
    .post(parsed.endpoint, buildEnvelope(err, context), {
      headers: { "Content-Type": "application/x-sentry-envelope", "X-Sentry-Auth": parsed.authHeader },
      timeout: SEND_TIMEOUT_MS,
      maxRedirects: 0,
      validateStatus: () => true,
    })
    .catch((sendErr: Error) => {
      process.stderr.write(
        `${JSON.stringify({ time: new Date().toISOString(), level: "warn", msg: "Error report not delivered", err: sendErr.message.slice(0, 200) })}\n`,
      );
    });
}

/** Test hook: forget the rate-limit window. */
export function resetErrorReporter(): void {
  windowStart = 0;
  sentInWindow = 0;
}
