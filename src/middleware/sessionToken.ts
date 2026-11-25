/**
 * middleware/sessionToken.ts — Where a request's session token comes from.
 *
 * An Authorization header wins when there is one (API clients, tests, anything that opted out of
 * cookies). Otherwise the HttpOnly session cookie is used, and then a write must also pass the
 * origin check, because a cookie travels with requests another site may have caused.
 */

import type { Request } from "express";
import { isTrustedWrite, readSessionCookie, type SessionRole } from "../lib/sessionCookie.js";

export type TokenSource = { token: string; via: "header" | "cookie" } | { rejected: "missing" | "cross-site" };

export function bearerToken(req: Pick<Request, "header">): string | null {
  const header = req.header("authorization");
  if (!header || !header.toLowerCase().startsWith("bearer ")) return null;
  return header.slice("bearer ".length).trim() || null;
}

export function tokenFor(req: Request, role: SessionRole): TokenSource {
  const bearer = bearerToken(req);
  if (bearer) return { token: bearer, via: "header" };
  const cookie = readSessionCookie(req, role);
  if (!cookie) return { rejected: "missing" };
  if (!isTrustedWrite(req)) return { rejected: "cross-site" };
  return { token: cookie, via: "cookie" };
}

/** Same, for routes that accept either role: the header first, then the customer cookie, then the shopkeeper's. */
export function anyTokens(req: Request): { tokens: { token: string; role?: SessionRole }[] } | { rejected: "missing" | "cross-site" } {
  const bearer = bearerToken(req);
  if (bearer) return { tokens: [{ token: bearer }] };
  const tokens = (["customer", "shopkeeper"] as const).flatMap((role) => {
    const token = readSessionCookie(req, role);
    return token ? [{ token, role }] : [];
  });
  if (tokens.length === 0) return { rejected: "missing" };
  if (!isTrustedWrite(req)) return { rejected: "cross-site" };
  return { tokens };
}
