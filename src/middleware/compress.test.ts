import assert from "node:assert/strict";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { gunzipSync } from "node:zlib";
import express from "express";
import { MIN_COMPRESS_BYTES, acceptsGzip, compressJson } from "./compress.js";

const BIG = { items: Array.from({ length: 400 }, (_, i) => ({ id: i, name: `Template number ${i}`, tags: ["a", "b", "c"] })) };
const SMALL = { ok: true };

describe("acceptsGzip", () => {
  it("reads the Accept-Encoding header", () => {
    assert.equal(acceptsGzip("gzip, deflate, br"), true);
    assert.equal(acceptsGzip("br;q=1.0, gzip;q=0.8"), true);
    assert.equal(acceptsGzip("*"), true);
    assert.equal(acceptsGzip("GZIP"), true);
    assert.equal(acceptsGzip("deflate, br"), false);
    assert.equal(acceptsGzip("gzip;q=0"), false, "q=0 is a refusal");
    assert.equal(acceptsGzip("identity"), false);
    assert.equal(acceptsGzip(undefined), false);
    assert.equal(acceptsGzip(""), false);
  });
});

describe("compressJson", () => {
  let server: Server;
  let port: number;

  before(async () => {
    const app = express();
    app.set("etag", "weak");
    app.use(compressJson);
    app.get("/big", (_req, res) => void res.json(BIG));
    app.get("/small", (_req, res) => void res.json(SMALL));
    app.get("/text", (_req, res) => void res.type("text/plain").send("x".repeat(5000)));
    app.get("/empty", (_req, res) => void res.status(204).end());
    app.get("/no-transform", (_req, res) => void res.set("Cache-Control", "no-transform").json(BIG));
    app.get("/already", (_req, res) => void res.set("Content-Encoding", "identity").json(BIG));
    app.get("/error", (_req, res) => void res.status(500).json({ ...BIG, message: "boom" }));
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    port = (server.address() as AddressInfo).port;
  });
  after(() => void server.close());

  function get(path: string, headers: Record<string, string> = {}, method = "GET") {
    return new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }>((resolve, reject) => {
      const req = request({ port, path, method, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      req.on("error", reject);
      req.end();
    });
  }

  it("gzips a large JSON body for a client that accepts it, and it decodes to the same data", async () => {
    const plain = Buffer.byteLength(JSON.stringify(BIG));
    assert.ok(plain > MIN_COMPRESS_BYTES);
    const res = await get("/big", { "Accept-Encoding": "gzip" });
    assert.equal(res.status, 200);
    assert.equal(res.headers["content-encoding"], "gzip");
    assert.match(String(res.headers["content-type"]), /^application\/json/);
    assert.ok(res.body.length < plain / 4, `expected a big saving, got ${res.body.length} of ${plain}`);
    assert.equal(res.headers["content-length"], String(res.body.length), "length describes the compressed bytes");
    assert.deepEqual(JSON.parse(gunzipSync(res.body).toString()), BIG);
    assert.match(String(res.headers.vary), /Accept-Encoding/i);
  });

  it("leaves the body alone when the client did not ask, or refused", async () => {
    const refusals: Record<string, string>[] = [{}, { "Accept-Encoding": "identity" }, { "Accept-Encoding": "gzip;q=0" }, { "Accept-Encoding": "br" }];
    for (const headers of refusals) {
      const res = await get("/big", headers);
      assert.equal(res.headers["content-encoding"], undefined, JSON.stringify(headers));
      assert.deepEqual(JSON.parse(res.body.toString()), BIG);
    }
  });

  it("does not bother with small bodies, but still tells caches the reply varies by encoding", async () => {
    const res = await get("/small", { "Accept-Encoding": "gzip" });
    assert.equal(res.headers["content-encoding"], undefined);
    assert.deepEqual(JSON.parse(res.body.toString()), SMALL);
    assert.match(String(res.headers.vary), /Accept-Encoding/i);
  });

  it("only touches JSON", async () => {
    const res = await get("/text", { "Accept-Encoding": "gzip" });
    assert.equal(res.headers["content-encoding"], undefined);
    assert.equal(res.body.toString(), "x".repeat(5000));
  });

  it("leaves empty replies, HEAD requests, no-transform and already-encoded bodies alone", async () => {
    assert.equal((await get("/empty", { "Accept-Encoding": "gzip" })).status, 204);
    const head = await get("/big", { "Accept-Encoding": "gzip" }, "HEAD");
    assert.equal(head.headers["content-encoding"], undefined);
    assert.equal(head.body.length, 0);
    assert.equal((await get("/no-transform", { "Accept-Encoding": "gzip" })).headers["content-encoding"], undefined);
    assert.equal((await get("/already", { "Accept-Encoding": "gzip" })).headers["content-encoding"], "identity");
  });

  it("compresses error responses too, keeping their status", async () => {
    const res = await get("/error", { "Accept-Encoding": "gzip" });
    assert.equal(res.status, 500);
    assert.equal(res.headers["content-encoding"], "gzip");
    assert.equal(JSON.parse(gunzipSync(res.body).toString()).message, "boom");
  });

  it("answers a repeat request with 304 and no body when the representation has not changed", async () => {
    const first = await get("/big", { "Accept-Encoding": "gzip" });
    const etag = String(first.headers.etag);
    assert.ok(etag, "an ETag is sent for the compressed representation");
    const second = await get("/big", { "Accept-Encoding": "gzip", "If-None-Match": etag });
    assert.equal(second.status, 304);
    assert.equal(second.body.length, 0);
  });
});
