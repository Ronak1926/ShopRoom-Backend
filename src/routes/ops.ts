/**
 * routes/ops.ts — Endpoints for monitors, not for the app.
 *
 *   GET /healthz  liveness: the process is up and serving HTTP.
 *   GET /readyz   readiness: it can also reach the database. Point the external
 *                 uptime check here; it fails when the thing users need fails.
 *   GET /metrics  Prometheus metrics, only with `Authorization: Bearer METRICS_TOKEN`.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { prisma } from "../database/prisma.js";
import { logger } from "../lib/logger.js";
import { renderMetrics } from "../lib/metrics.js";

const READY_TIMEOUT_MS = 2000;

export const opsRouter = Router();

opsRouter.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

opsRouter.get("/readyz", async (_req, res) => {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("database check timed out")), READY_TIMEOUT_MS);
      }),
    ]);
    res.json({ status: "ok", database: "up" });
  } catch (err) {
    logger.warn("Readiness check failed", undefined, err);
    res.status(503).json({ status: "unavailable", database: "down" });
  } finally {
    clearTimeout(timer);
  }
});

const digest = (value: string) => createHash("sha256").update(value).digest();

function requireMetricsToken(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.METRICS_TOKEN;
  const header = req.header("authorization") ?? "";
  const presented = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  // Same answer whether the endpoint is disabled or the token is wrong.
  if (!expected || !timingSafeEqual(digest(presented), digest(expected))) {
    res.status(401).json({ message: "Missing Authorization header" });
    return;
  }
  next();
}

opsRouter.get("/metrics", requireMetricsToken, (_req, res) => {
  res.type("text/plain; version=0.0.4").send(renderMetrics());
});
