/**
 * lib/logger.ts — One JSON object per line on stdout (info/debug) or stderr
 * (warn/error), ready for any log shipper.
 *
 * - Every line carries the current correlation id (see requestContext.ts).
 * - Field names that can hold secrets or personal data are redacted before
 *   anything is written, so a careless `logger.info("x", { body })` can't leak.
 * - Errors are reduced to name, code, a truncated message and a short stack;
 *   error objects from drivers and SDKs can carry request data, so the raw
 *   object is never serialised.
 * - Level comes from LOG_LEVEL (debug | info | warn | error | silent), default info.
 */

import { currentRequestId } from "./requestContext.js";
import { reportError } from "./errorReporter.js";

type Level = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const RANK: Record<Level | "silent", number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

const SENSITIVE_KEY =
  /pass(word)?|secret|token|authorization|cookie|otp|^code$|email|phone|signature|private|dsn|api[-_]?key|credential/i;
const MAX_DEPTH = 4;
const MAX_STRING = 500;
const MAX_STACK_LINES = 8;

function threshold(): number {
  const configured = process.env.LOG_LEVEL?.toLowerCase();
  return configured && configured in RANK ? RANK[configured as keyof typeof RANK] : RANK.info;
}

function truncate(value: string): string {
  return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
}

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return truncate(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return serializeError(value);
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redact(item, depth + 1));
  if (typeof value === "object") {
    const out: LogFields = {};
    for (const [key, item] of Object.entries(value as LogFields)) {
      out[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : redact(item, depth + 1);
    }
    return out;
  }
  return String(value);
}

export function serializeError(err: Error): LogFields {
  const code = (err as { code?: unknown }).code;
  return {
    name: err.name,
    ...(typeof code === "string" || typeof code === "number" ? { code } : {}),
    message: truncate(err.message),
    ...(err.stack ? { stack: err.stack.split("\n").slice(0, MAX_STACK_LINES).join("\n") } : {}),
  };
}

type Sink = (line: string, level: Level) => void;
let sink: Sink | null = null;

/** Test hook: capture log lines instead of writing them. Pass null to restore. */
export function setLogSink(next: Sink | null): void {
  sink = next;
}

function write(level: Level, msg: string, fields?: LogFields, detail?: unknown): void {
  if (RANK[level] < threshold()) return;
  const requestId = currentRequestId();
  const err = detail instanceof Error ? serializeError(detail) : redact(detail);
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    msg,
    ...(requestId ? { requestId } : {}),
    ...(fields ? (redact(fields) as LogFields) : {}),
    ...(err === undefined ? {} : { err }),
  });
  if (sink) {
    sink(line, level);
    return;
  }
  (level === "warn" || level === "error" ? process.stderr : process.stdout).write(`${line}\n`);
}

/**
 * Failures the caller caused and was told about (wrong code, invalid input,
 * plan limits). They are logged as warnings and never sent to the error
 * tracker; real faults (including 5xx NotificationErrors) are errors.
 */
const EXPECTED_ERRORS = new Set(["RegistrationError", "VerifyError", "OtpCooldownError"]);

export function isExpectedError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (EXPECTED_ERRORS.has(err.name)) return true;
  const status = (err as { status?: unknown }).status;
  return err.name === "NotificationError" && typeof status === "number" && status < 500;
}

export const logger = {
  debug: (msg: string, fields?: LogFields) => write("debug", msg, fields),
  info: (msg: string, fields?: LogFields) => write("info", msg, fields),
  warn: (msg: string, fields?: LogFields, detail?: unknown) => write("warn", msg, fields, detail),
  /** `detail` is usually the caught error; Error instances are also sent to the error tracker. */
  error: (msg: string, detail?: unknown, fields?: LogFields) => {
    if (isExpectedError(detail)) {
      write("warn", msg, fields, detail);
      return;
    }
    write("error", msg, fields, detail);
    if (detail instanceof Error) reportError(detail, { message: msg, requestId: currentRequestId() });
  },
};
