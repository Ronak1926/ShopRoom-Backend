import { gzip } from "node:zlib";
import type { NextFunction, Request, Response } from "express";

/** Below this a gzip header and the extra CPU cost more than they save. */
export const MIN_COMPRESS_BYTES = 1024;

/** True when the client accepts gzip (an explicit `q=0` counts as refusing it). */
export function acceptsGzip(header: string | undefined): boolean {
  if (!header) return false;
  return header.split(",").some((part) => {
    const [coding, ...params] = part.trim().toLowerCase().split(";");
    if (coding !== "gzip" && coding !== "*") return false;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    return q === undefined || Number(q.slice(2)) > 0;
  });
}

/**
 * Gzips JSON response bodies for clients that accept it. The catalogue of notification
 * templates is ~500 KB of JSON and gzips to ~30 KB, so this is the cheapest speed-up the
 * API has. Built on node:zlib so it adds no dependency; deliberately limited to JSON,
 * because that is all this API sends.
 *
 * It wraps res.send, which res.json calls, so it runs after Express has settled the status,
 * content type and conditional-request handling, and it steps aside whenever any of the
 * following is true: the body is small, the client did not ask, the response is already
 * encoded, empty (204/304), a HEAD reply, or marked no-transform.
 */
export function compressJson(req: Request, res: Response, next: NextFunction): void {
  if (!acceptsGzip(req.headers["accept-encoding"]) || req.method === "HEAD") {
    next();
    return;
  }

  const send = res.send.bind(res);
  res.send = (body?: unknown): Response => {
    const type = String(res.getHeader("Content-Type") ?? "");
    const plain =
      (typeof body === "string" || Buffer.isBuffer(body)) &&
      type.startsWith("application/json") &&
      !res.getHeader("Content-Encoding") &&
      !/\bno-transform\b/i.test(String(res.getHeader("Cache-Control") ?? "")) &&
      res.statusCode !== 204 &&
      res.statusCode !== 304;
    if (!plain) return send(body);

    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body as string);
    // Caches must keep a separate copy per encoding, whether or not this particular reply is compressed.
    res.vary("Accept-Encoding");
    if (bytes.length < MIN_COMPRESS_BYTES) return send(body);

    gzip(bytes, (err, compressed) => {
      if (err) {
        send(body);
        return;
      }
      res.setHeader("Content-Encoding", "gzip");
      // Any ETag was computed for the plain body; Express recomputes it for what is actually sent.
      res.removeHeader("ETag");
      send(compressed);
    });
    return res;
  };

  next();
}
