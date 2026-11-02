/**
 * routes/clientErrors.ts — Intake for errors caught in the web app.
 *
 * Unauthenticated by necessity (errors happen before sign-in too), so it is
 * strictly bounded: tiny schema, per-IP rate limit, nothing stored beyond a
 * log line and a counter, and the client's text is only ever logged as data.
 */

import { Router } from "express";
import z from "zod";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { logger } from "../lib/logger.js";
import { clientErrors } from "../lib/metrics.js";

const limiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
  message: { message: "Too many reports." },
  standardHeaders: true,
  legacyHeaders: false,
});

const schema = z.object({
  message: z.string().max(300),
  stack: z.string().max(2000).optional(),
  /** Path only; the client strips query strings and fragments. */
  path: z.string().max(200).optional(),
  kind: z.enum(["error", "unhandledrejection", "boundary"]).default("error"),
});

export const clientErrorsRouter = Router();

clientErrorsRouter.post("/", limiter, (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid report" });
    return;
  }
  clientErrors.inc({ kind: parsed.data.kind });
  logger.warn("Client error", {
    kind: parsed.data.kind,
    path: parsed.data.path,
    clientMessage: parsed.data.message,
    clientStack: parsed.data.stack,
  });
  res.status(204).end();
});
