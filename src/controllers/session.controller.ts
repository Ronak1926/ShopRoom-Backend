/**
 * controllers/session.controller.ts — Ending a browser session.
 *
 * The session cookie is HttpOnly, so the page cannot delete it; this endpoint does. It needs no
 * authentication on purpose (signing out must work even when the session has already expired) and
 * changes nothing else: it only tells the browser to drop its cookie. When a session cookie is present,
 * the request must pass the same cross-site check as any other cookie-authenticated write, so another
 * site cannot sign a visitor out. Signing out everywhere,
 * which also invalidates tokens held elsewhere, is a separate authenticated endpoint.
 */

import type { Request, Response } from "express";
import { clearSessionCookie, isTrustedWrite, readSessionCookie, type SessionRole } from "../lib/sessionCookie.js";

export function logoutHandler(role: SessionRole) {
  return (req: Request, res: Response): void => {
    if (readSessionCookie(req, role) && !isTrustedWrite(req)) {
      res.status(403).json({ message: "Request not allowed" });
      return;
    }
    clearSessionCookie(res, role);
    res.json({ message: "Signed out" });
  };
}
