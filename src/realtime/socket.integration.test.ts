import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { createCustomer, createShop, integrationConfigured, resetDatabase } from "../test/integration.js";
import { startTestApp, type TestApp } from "../test/http.js";
import { connectSocket, type SocketClient } from "../test/socketClient.js";
import { setLogSink } from "../lib/logger.js";
import { resetMetrics, socketConnections } from "../lib/metrics.js";

const enabled = integrationConfigured();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Socket.IO chat", { skip: !enabled }, () => {
  let t: TestApp;
  let server: Server;
  let url: string;
  let open: SocketClient[];
  let PRESENCE_WINDOW_MS: number;

  before(async () => {
    t = await startTestApp();
    // Imported after the test environment exists: the socket module opens the database on load.
    const socket = await import("./socket.js");
    PRESENCE_WINDOW_MS = socket.PRESENCE_WINDOW_MS;
    server = createServer(t.app);
    socket.createSocketServer(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(async () => {
    server.closeAllConnections();
    server.close();
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    t.clearSessionCache();
    resetMetrics();
    open = [];
  });
  afterEach(() => open.forEach((client) => client.close()));

  async function customerSocket(customerId: string) {
    const client = connectSocket(url, { token: t.customerToken(customerId), role: "customer" });
    open.push(client);
    await client.ready;
    return client;
  }

  async function roomWithMembers(count: number) {
    const shop = await createShop(t.prisma);
    const members = await Promise.all(
      Array.from({ length: count }, () => createCustomer(t.prisma, { member: { roomId: shop.roomId }, devices: 0 })),
    );
    return { shop, members: members.map((m) => m.customerId) };
  }

  describe("connecting", () => {
    it("accepts a valid session and refuses everything else", async () => {
      const { members } = await roomWithMembers(1);
      await customerSocket(members[0]);

      const refused: SocketClient[] = [
        connectSocket(url, { token: "garbage", role: "customer" }),
        connectSocket(url, { token: t.customerToken(members[0]), role: "shopkeeper" }),
        connectSocket(url, { token: t.customerToken(members[0], 7), role: "customer" }),
        connectSocket(url, { token: t.shopkeeperToken(members[0]), role: "customer" }),
      ];
      open.push(...refused);
      for (const client of refused) await assert.rejects(client.ready, /Unauthorized/);
    });

    it("stops accepting a session that was revoked", async () => {
      const { members } = await roomWithMembers(1);
      await t.prisma.customer.update({ where: { id: members[0] }, data: { tokenVersion: { increment: 1 } } });
      t.clearSessionCache();
      const client = connectSocket(url, { token: t.customerToken(members[0], 0), role: "customer" });
      open.push(client);
      await assert.rejects(client.ready, /Unauthorized/);
    });

    it("keeps the connection count metric honest", async () => {
      const { members } = await roomWithMembers(3);
      const clients = await Promise.all(members.map(customerSocket));
      assert.equal(socketConnections.get(), 3);
      clients[0].close();
      clients[1].close();
      await sleep(200);
      assert.equal(socketConnections.get(), 1);
    });
  });

  describe("rooms", () => {
    it("lets members chat and keeps outsiders out", async () => {
      const { shop, members } = await roomWithMembers(2);
      const other = await roomWithMembers(1);
      const [alice, bob] = await Promise.all(members.map(customerSocket));
      const outsider = await customerSocket(other.members[0]);
      for (const client of [alice, bob]) client.emit("room:join", { roomId: shop.roomId });
      outsider.emit("room:join", { roomId: shop.roomId });
      await outsider.waitFor("error", (p) => p.message === "Access denied");

      alice.emit("message:send", { roomId: shop.roomId, text: "hello room" });
      const delivered = await bob.waitFor("message:new", (p) => p.text === "hello room");
      assert.equal(delivered.roomId, shop.roomId);
      await sleep(150);
      assert.ok(!outsider.received.some((e) => e.event === "message:new"), "an outsider never receives the room's messages");
    });

    it("refuses to send into a room the sender never joined", async () => {
      const { shop } = await roomWithMembers(1);
      const other = await roomWithMembers(1);
      const outsider = await customerSocket(other.members[0]);
      outsider.emit("message:send", { roomId: shop.roomId, text: "sneaky" });
      await outsider.waitFor("error", (p) => p.message === "Could not send message");
      assert.equal(await t.prisma.message.count({ where: { roomId: shop.roomId } }), 0);
    });

    it("ignores malformed events instead of crashing the connection", async () => {
      const { shop, members } = await roomWithMembers(1);
      const client = await customerSocket(members[0]);
      client.emit("room:join", { roomId: { $ne: "x" } });
      client.emit("room:join", { roomId: "x".repeat(500) });
      client.emit("message:send", { roomId: shop.roomId, text: 42 });
      client.emit("message:react", { roomId: shop.roomId, messageId: ["a"], emoji: "👍" });
      client.emit("room:join", { roomId: shop.roomId });
      client.emit("message:send", { roomId: shop.roomId, text: "still alive" });
      await client.waitFor("message:new", (p) => p.text === "still alive");
    });

    it("rate limits a socket that floods messages", async () => {
      const { shop, members } = await roomWithMembers(1);
      const client = await customerSocket(members[0]);
      client.emit("room:join", { roomId: shop.roomId });
      for (let i = 0; i < 15; i += 1) client.emit("message:send", { roomId: shop.roomId, text: `m${i}` });
      await client.waitFor("error", (p) => /too fast/i.test(p.message));
      await sleep(300);
      assert.ok((await t.prisma.message.count({ where: { roomId: shop.roomId } })) <= 10);
    });
  });

  describe("presence", () => {
    it("coalesces a burst of joins into a few broadcasts that end with everyone online", async () => {
      const { shop, members } = await roomWithMembers(40);
      const clients = await Promise.all(members.map(customerSocket));
      const watcher = clients[0];
      clients.forEach((client) => client.emit("room:join", { roomId: shop.roomId }));

      const everyone = await watcher.waitFor("presence:update", (p) => p.onlineCustomerIds.length === 40, 5000);
      assert.deepEqual([...everyone.onlineCustomerIds].sort(), [...members].sort());

      await sleep(PRESENCE_WINDOW_MS + 200);
      const broadcasts = watcher.received.filter((e) => e.event === "presence:update").length;
      assert.ok(broadcasts <= 6, `40 joins produced ${broadcasts} presence broadcasts (one per join would be 40)`);
    });

    it("reports a member who leaves or disconnects", async () => {
      const { shop, members } = await roomWithMembers(2);
      const [a, b] = await Promise.all(members.map(customerSocket));
      a.emit("room:join", { roomId: shop.roomId });
      b.emit("room:join", { roomId: shop.roomId });
      await a.waitFor("presence:update", (p) => p.onlineCustomerIds.length === 2);

      b.close();
      await a.waitFor("presence:update", (p) => p.onlineCustomerIds.length === 1 && p.onlineCustomerIds[0] === members[0], 3000);
    });
  });

  describe("observability", () => {
    it("logs a failing event under its own ws- correlation id", async () => {
      const lines: Record<string, any>[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any -- parsed log JSON
      process.env.LOG_LEVEL = "debug";
      setLogSink((line) => lines.push(JSON.parse(line)));
      try {
        const { shop, members } = await roomWithMembers(1);
        const client = await customerSocket(members[0]);
        client.emit("room:join", { roomId: shop.roomId });
        client.emit("message:react", { roomId: shop.roomId, messageId: "no-such-message", emoji: "👍" });
        await client.waitFor("error", (p) => p.message === "Could not react to message");
        const warning = lines.find((l) => l.msg === "Socket reaction failed");
        assert.ok(warning, "the failure is logged");
        assert.match(warning.requestId, /^ws-[0-9a-f-]{36}$/);
        assert.equal(warning.roomId, shop.roomId);
      } finally {
        setLogSink(null);
        process.env.LOG_LEVEL = "silent";
      }
    });

    it("tells the client only user-facing reasons, never database details", async () => {
      const { shop, members } = await roomWithMembers(2);
      const [a, b] = await Promise.all(members.map(customerSocket));
      a.emit("room:join", { roomId: shop.roomId });
      b.emit("room:join", { roomId: shop.roomId });
      a.emit("message:send", { roomId: shop.roomId, text: "mine" });
      const message = await b.waitFor("message:new", (p) => p.text === "mine");

      b.emit("message:edit", { roomId: shop.roomId, messageId: message.id, text: "hijack" });
      await b.waitFor("error", (p) => p.message === "Not your message");
      b.emit("message:edit", { roomId: shop.roomId, messageId: "ghost-id", text: "x" });
      await b.waitFor("error", (p) => p.message === "Message not found");
      assert.equal((await t.prisma.message.findFirstOrThrow({ where: { id: message.id } })).editedAt, null);
    });
  });
});
