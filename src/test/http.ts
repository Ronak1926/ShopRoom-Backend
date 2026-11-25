/**
 * test/http.ts — Boots the real Express app on an ephemeral port for HTTP-level
 * tests against the test database.
 *
 * Every request carries an X-Forwarded-For address (the app trusts one proxy
 * hop under test) so each test gets its own rate-limit bucket and can't be
 * throttled by earlier tests; limiter tests pin one address deliberately.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { connectTestEnvironment } from "./integration.js";

export interface CallOptions {
  token?: string;
  body?: unknown;
  /** Sent verbatim instead of JSON-encoding `body` (for malformed-body tests). */
  rawBody?: string;
  headers?: Record<string, string>;
  /** Client address for rate limiting; defaults to the current test's address. */
  ip?: string;
}

export interface CallResult {
  status: number;
  json: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- tests probe arbitrary response shapes
  headers: Headers;
}

export async function startTestApp() {
  process.env.TRUST_PROXY_HOPS = "1";
  const env = await connectTestEnvironment();
  const { app, allRouteMounts } = await import("../app.js");
  const jwt = await import("../utils/jwt.js");
  const session = await import("../services/session.service.js");

  const server: Server = createServer(app).listen(0);
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  let testNumber = 0;
  let defaultIp = "10.0.0.1";

  /** Gives the next test its own client address. */
  function newClientIp(): string {
    testNumber += 1;
    defaultIp = `10.${Math.floor(testNumber / 250)}.${testNumber % 250}.1`;
    return defaultIp;
  }

  async function call(method: string, path: string, options: CallOptions = {}): Promise<CallResult> {
    const hasBody = options.body !== undefined || options.rawBody !== undefined;
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        "X-Forwarded-For": options.ip ?? defaultIp,
        ...options.headers,
      },
      body: options.rawBody ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, json, headers: res.headers };
  }

  return {
    ...env,
    app,
    routeMounts: allRouteMounts,
    baseUrl,
    call,
    newClientIp,
    /** Sessions are cached for a few seconds; tests that edit accounts directly must drop the cache. */
    clearSessionCache: session.clearSessionCache,
    customerToken: (id: string, tokenVersion = 0) => jwt.signCustomerToken(id, tokenVersion),
    shopkeeperToken: (id: string, tokenVersion = 0) => jwt.signShopkeeperToken(id, tokenVersion),
    async close() {
      server.close();
      await env.prisma.$disconnect();
    },
  };
}

export type TestApp = Awaited<ReturnType<typeof startTestApp>>;
