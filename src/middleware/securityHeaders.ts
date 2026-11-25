import type { NextFunction, Request, Response } from "express";
import { isProduction } from "../config/env.js";

/**
 * Response headers for a JSON API. Nothing here is ever meant to be rendered,
 * framed or cached, so the policy is as tight as it can be.
 *
 * HSTS is only sent in production: browsers pin it for a year, which would
 * break plain-http localhost development.
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  );
  res.setHeader("Permissions-Policy", "geolocation=(), camera=(), microphone=(), payment=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  // Responses carry personal data; handlers that are safe to cache opt in themselves.
  res.setHeader("Cache-Control", "no-store");
  if (isProduction()) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
}
