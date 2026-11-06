/**
 * controllers/session.controller.ts — Ending a browser session.
 *
 * The session cookie is HttpOnly, so the page cannot delete it; this endpoint does. It needs no
 * authentication on purpose (signing out must work even when the session has already expired) and
 * changes nothing else: it only tells the browser to drop its cookie. Signing out everywhere,
 * which also invalidates tokens held elsewhere, is a separate authenticated endpoint.
 */

import type { Request, Response } from "express";
import { clearSessionCookie, type SessionRole } from "../lib/sessionCookie.js";

export function logoutHandler(role: SessionRole) {
  return (_req: Request, res: Response): void => {
    clearSessionCookie(res, role);
    res.json({ message: "Signed out" });
  };
}
