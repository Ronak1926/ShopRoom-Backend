import type { NextFunction, Request, Response } from "express";

interface HttpError extends Error {
  status?: number;
  statusCode?: number;
  type?: string;
}

/** 404 for unmatched routes, as JSON and without naming the framework. */
export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ message: "Not found" });
}

/**
 * Last-resort handler. Client mistakes that body-parser detects get a precise
 * status; everything else is logged server-side and answered with a generic
 * message so stack traces and internals never reach the client.
 */
export function errorHandler(
  err: HttpError,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err.type === "entity.too.large") {
    res.status(413).json({ message: "Request body is too large" });
    return;
  }
  if (err.type === "entity.parse.failed" || err.type === "encoding.unsupported") {
    res.status(400).json({ message: "Malformed request body" });
    return;
  }

  console.error("Unhandled error:", err.message);
  res.status(500).json({ message: "Something went wrong. Please try again." });
}
