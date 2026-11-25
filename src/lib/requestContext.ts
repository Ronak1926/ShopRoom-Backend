/**
 * lib/requestContext.ts — Carries a correlation id through everything one unit
 * of work triggers: an HTTP request, a Socket.IO event, or a background job.
 * The logger stamps it on every line, so a single id finds the whole story.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

interface RequestContext {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Ids from outside are only trusted when they look like ids (no log injection, bounded size). */
const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

export function newRequestId(prefix?: string): string {
  const id = randomUUID();
  return prefix ? `${prefix}-${id}` : id;
}

export function acceptRequestId(candidate: unknown): string {
  return typeof candidate === "string" && SAFE_ID.test(candidate) ? candidate : newRequestId();
}

export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return storage.run({ requestId }, fn);
}

/** Runs `fn` under a fresh id, e.g. one per socket event ("ws-…") or job run ("job-…"). */
export function withNewRequestId<T>(prefix: string, fn: () => T): T {
  return runWithRequestId(newRequestId(prefix), fn);
}
