import type { NextFunction, Request, Response } from "express";
import { logger } from "../lib/logger.js";
import { httpDuration, httpRequests } from "../lib/metrics.js";
import { acceptRequestId, runWithRequestId } from "../lib/requestContext.js";
import { recordHttpStatus } from "../services/alerting.service.js";

const QUIET_PATHS = new Set(["/healthz", "/readyz", "/metrics"]);

/**
 * The route pattern ("/api/rooms/:roomId/messages"), never the raw URL: raw
 * URLs contain ids (high-cardinality metrics) and sometimes secrets.
 */
export function routeLabel(req: Request): string {
  return req.route?.path ? `${req.baseUrl}${req.route.path === "/" ? "" : req.route.path}` || "/" : "unmatched";
}

/**
 * Gives every request a correlation id (the caller's X-Request-Id when it looks
 * like one, otherwise a new UUID), echoes it back, and records one access-log
 * line plus latency/count metrics when the response finishes.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const requestId = acceptRequestId(req.header("x-request-id"));
  res.setHeader("X-Request-Id", requestId);
  const started = process.hrtime.bigint();

  res.on("finish", () => {
    const seconds = Number(process.hrtime.bigint() - started) / 1e9;
    const route = routeLabel(req);
    const status = res.statusCode;
    if (route !== "/metrics") {
      httpRequests.inc({ method: req.method, route, status: `${Math.floor(status / 100)}xx` });
      httpDuration.observe(seconds, { method: req.method, route });
      recordHttpStatus(status);
    }
    runWithRequestId(requestId, () => {
      const fields = { method: req.method, route, status, durationMs: Math.round(seconds * 1000) };
      if (QUIET_PATHS.has(req.path)) logger.debug("request", fields);
      else if (status >= 500) logger.error("request", undefined, fields);
      else logger.info("request", fields);
    });
  });

  runWithRequestId(requestId, next);
}
