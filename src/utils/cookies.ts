/**
 * utils/cookies.ts — Reading the Cookie header and writing Set-Cookie, without a dependency.
 * Pure functions: the session logic that uses them lives in lib/sessionCookie.ts.
 */

/** Parses a Cookie request header into name/value pairs. Malformed pieces are skipped; the first of a repeated name wins. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    if (!name || name in cookies) continue;
    let value = part.slice(index + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1);
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  return cookies;
}

export interface CookieOptions {
  /** Lifetime in seconds; 0 deletes the cookie. */
  maxAgeSeconds: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
  domain?: string;
  path?: string;
}

const TOKEN_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
const SAFE_VALUE = /^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*$/;
const DOMAIN = /^\.?[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$/;

/** Builds a Set-Cookie value. Throws on a name, value or domain that could inject another attribute or header. */
export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  if (!TOKEN_NAME.test(name)) throw new Error("Invalid cookie name");
  const encoded = encodeURIComponent(value);
  if (!SAFE_VALUE.test(encoded)) throw new Error("Invalid cookie value");
  const parts = [`${name}=${encoded}`, `Path=${options.path ?? "/"}`];
  if (options.domain) {
    if (!DOMAIN.test(options.domain)) throw new Error("Invalid cookie domain");
    parts.push(`Domain=${options.domain}`);
  }
  parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`);
  if (options.maxAgeSeconds <= 0) parts.push("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  parts.push(`SameSite=${{ lax: "Lax", strict: "Strict", none: "None" }[options.sameSite ?? "lax"]}`);
  return parts.join("; ");
}
