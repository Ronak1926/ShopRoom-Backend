/**
 * test/receiver.ts — A local HTTP server that records what it is sent; stands in
 * for a Slack webhook or a Sentry collector in tests.
 */

import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface ReceivedRequest {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}

export async function startReceiver(status = 200) {
  const requests: ReceivedRequest[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      requests.push({
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      res.statusCode = status;
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    requests,
    port,
    url: `http://127.0.0.1:${port}`,
    /** Resolves once `count` requests have arrived (or rejects after a timeout). */
    async waitFor(count: number, timeoutMs = 3000): Promise<ReceivedRequest[]> {
      const end = Date.now() + timeoutMs;
      while (requests.length < count) {
        if (Date.now() > end) throw new Error(`expected ${count} request(s), got ${requests.length}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return requests;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
