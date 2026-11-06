/**
 * lib/sessionCookie.ts — Browser sessions in HttpOnly cookies.
 *
 * Why: a session token that JavaScript can read can be stolen by any script that runs on the page.
 * An HttpOnly cookie cannot be read by script at all; the browser attaches it to requests to the API.
 *
 * Opt-in: a browser says `X-Session-Mode: cookie` and then gets a cookie instead of a token in the
 * response body. Anything else (tests, scripts, mobile apps) keeps the Authorization header exactly as before.
 *
 * Cross-site requests: the cookie is SameSite=Lax (never sent on a cross-site POST), and a cookie-authenticated
 * write must also come from an allowed origin (`isTrustedWrite`), so a page on another site cannot act as the user.
 * Run the API on a subdomain of the same site as the web app; for different sites set COOKIE_SAMESITE=none
 * (that requires HTTPS, and browsers that block third-party cookies will not work).
 */

import type { Request, Response } from "express";
import { allowedOrigins, isProduction } from "../config/env.js";
import { parseCookies, serializeCookie } from "../utils/cookies.js";

export type SessionRole = "customer" | "shopkeeper";

export const SESSION_COOKIE: Record<SessionRole, string> = { customer: "sr_customer", shopkeeper: "sr_shopkeeper" };

/** Matches the lifetime of the tokens themselves (7 days). */
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function cookieAttributes(env: Record<string, string | undefined> = process.env) {
  const configured = env.COOKIE_SAMESITE?.trim().toLowerCase();
  const sameSite = configured === "none" || configured === "strict" ? configured : "lax";
  return {
    sameSite: sameSite as "lax" | "strict" | "none",
    // SameSite=None is only accepted with Secure; production is HTTPS.
    secure: isProduction(env) || sameSite === "none",
    domain: env.COOKIE_DOMAIN?.trim() || undefined,
  };
}

export function wantsCookieSession(req: Pick<Request, "header">): boolean {
  return req.header("x-session-mode") === "cookie";
}

export function setSessionCookie(res: Response, role: SessionRole, token: string): void {
  res.append("Set-Cookie", serializeCookie(SESSION_COOKIE[role], token, { maxAgeSeconds: MAX_AGE_SECONDS, httpOnly: true, ...cookieAttributes() }));
}

export function clearSessionCookie(res: Response, role: SessionRole): void {
  res.append("Set-Cookie", serializeCookie(SESSION_COOKIE[role], "", { maxAgeSeconds: 0, httpOnly: true, ...cookieAttributes() }));
}

export function readSessionCookie(req: Pick<Request, "headers">, role: SessionRole): string | null {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE[role]] || null;
}

/**
 * Hands the new session to the caller: in a cookie for a browser that asked for one, otherwise in
 * the body as `token` like before. Nothing else about the response changes.
 */
export function sendSession(req: Request, res: Response, role: SessionRole, token: string, body: Record<string, unknown> = {}, status = 200): void {
  if (wantsCookieSession(req)) {
    setSessionCookie(res, role, token);
    res.status(status).json(body);
  } else {
    res.status(status).json({ token, ...body });
  }
}

/** Is this origin one the API accepts browsers from? Outside production with no allow-list set, any is. */
export function isAllowedOrigin(origin: string | undefined, allowed: string[] | null = allowedOrigins()): boolean {
  if (allowed === null) return true;
  return origin !== undefined && allowed.includes(origin.replace(/\/+$/, ""));
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF guard for requests authenticated by cookie (the browser attached it, so the request may have been
 * started by another site). Reads are exempt; a write must come from an allowed origin. A request with no
 * Origin is a non-browser client unless the browser marks it cross-site.
 */
export function isTrustedWrite(req: Pick<Request, "method" | "headers">, allowed: string[] | null = allowedOrigins()): boolean {
  if (SAFE_METHODS.has(req.method)) return true;
  if (allowed === null) return true;
  const origin = req.headers.origin;
  if (typeof origin === "string") return isAllowedOrigin(origin, allowed);
  return req.headers["sec-fetch-site"] !== "cross-site";
}
