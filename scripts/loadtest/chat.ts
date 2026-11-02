// Load test for live chat: many connected members in ONE room, a subset sending.
// It measures connection time and, for every message, how long each connected
// member waited to receive it (fan-out latency).
//
// Speaks the Socket.IO v4 protocol over Node's built-in WebSocket, so it needs no
// extra package. Start the API first (against the database from seedPerf.sql),
// then:
//
//   TEST_DATABASE_URL=postgresql://…/shoproom_perf_test JWT_SECRET=<the API's> \
//   API_URL=http://localhost:3003 METRICS_TOKEN=<the API's> \
//     pnpm exec tsx scripts/loadtest/chat.ts 500 50 30
//
//   arg 1: connected members (default 500)   arg 2: of those, senders (default 50)
//   arg 3: seconds to keep sending (default 30; each sender posts every 2 s)
import { connectTestEnvironment } from "../../src/test/integration.js";

const members = Number(process.argv[2] ?? 500);
const senders = Math.min(Number(process.argv[3] ?? 50), members);
const durationSec = Number(process.argv[4] ?? 30);
const apiUrl = process.env.API_URL ?? "http://localhost:3003";

// connectTestEnvironment replaces JWT_SECRET with a test value; tokens must be signed
// with the running API's secret instead.
const apiSecret = process.env.JWT_SECRET;
const { prisma } = await connectTestEnvironment();
if (apiSecret) process.env.JWT_SECRET = apiSecret;
const { signCustomerToken } = await import("../../src/utils/jwt.js");

// The busiest room and some of its members.
const [{ roomId }] = await prisma.$queryRaw<{ roomId: string }[]>`
  SELECT "id" AS "roomId" FROM "Room" ORDER BY "membersCount" DESC LIMIT 1`;
const rows = await prisma.membership.findMany({ where: { roomId }, take: members, select: { customerId: true } });
if (rows.length < members) throw new Error(`room has only ${rows.length} members`);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const percentile = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : NaN);

interface Client {
  id: string;
  ws: WebSocket;
  connectedAt?: number;
  ready: Promise<void>;
  emit: (event: string, payload: unknown) => void;
}

const latencies: number[] = [];
let received = 0;
let errors = 0;
let sent = 0;
const connectMs: number[] = [];

function connect(customerId: string): Client {
  const token = signCustomerToken(customerId, 0);
  const ws = new WebSocket(`${apiUrl.replace(/^http/, "ws")}/socket.io/?EIO=4&transport=websocket`);
  const started = performance.now();
  let resolveReady!: () => void;
  let rejectReady!: (e: Error) => void;
  const ready = new Promise<void>((res, rej) => {
    resolveReady = res;
    rejectReady = rej;
  });
  ready.catch(() => undefined); // failures are counted later; don't crash on an early rejection
  const client: Client = {
    id: customerId,
    ws,
    ready,
    emit: (event, payload) => ws.send(`42${JSON.stringify([event, payload])}`),
  };

  ws.addEventListener("message", (message) => {
    const data = String(message.data);
    if (data.startsWith("0")) ws.send(`40${JSON.stringify({ token, role: "customer" })}`);
    else if (data === "2") ws.send("3");
    else if (data.startsWith("40")) {
      connectMs.push(performance.now() - started);
      resolveReady();
    } else if (data.startsWith("44")) {
      rejectReady(new Error(`connection refused: ${data.slice(2, 120)}`));
    } else if (data.startsWith("42")) {
      const [event, payload] = JSON.parse(data.slice(2)) as [string, { text?: string }];
      if (event === "message:new" && payload.text?.startsWith("lt:")) {
        received += 1;
        latencies.push(Date.now() - Number(payload.text.slice(3, payload.text.indexOf(":", 3))));
      } else if (event === "error") errors += 1;
    }
  });
  ws.addEventListener("error", () => rejectReady(new Error("websocket error")));
  return client;
}

console.log(`Connecting ${members} members to room ${roomId}…`);
const clients: Client[] = [];
for (let i = 0; i < rows.length; i += 50) {
  clients.push(...rows.slice(i, i + 50).map((r) => connect(r.customerId)));
  await sleep(100); // ramp up: 500 connections/s at most
}
const connectResults = await Promise.allSettled(clients.map((c) => c.ready));
const failed = connectResults.filter((r) => r.status === "rejected").length;
const live = clients.filter((_, i) => connectResults[i].status === "fulfilled");
live.forEach((c) => c.emit("room:join", { roomId }));
await sleep(Number(process.env.SETTLE_MS ?? 1500)); // lets the join-time presence broadcasts drain

const metric = async (name: string) => {
  const res = await fetch(`${apiUrl}/metrics`, { headers: { Authorization: `Bearer ${process.env.METRICS_TOKEN ?? ""}` } });
  const text = await res.text();
  return Number(new RegExp(`^${name} ([0-9]+)`, "m").exec(text)?.[1] ?? NaN);
};
const serverConnections = await metric("socket_connections");

console.log(`Sending from ${Math.min(senders, live.length)} members for ${durationSec}s…`);
const stopAt = Date.now() + durationSec * 1000;
const sendLoops = live.slice(0, senders).map(async (client, index) => {
  await sleep((index * 2000) / senders); // spread the senders across the 2 s period
  while (Date.now() < stopAt) {
    client.emit("message:send", { roomId, text: `lt:${Date.now()}:${client.id}` });
    sent += 1;
    await sleep(2000);
  }
});
await Promise.all(sendLoops);
await sleep(3000); // let in-flight deliveries land

const expected = sent * live.length;
const sorted = [...latencies].sort((a, b) => a - b);
const sortedConnect = [...connectMs].sort((a, b) => a - b);
const rss = await metric("process_resident_memory_bytes");
console.table({
  members: members,
  connected: live.length,
  connectFailures: failed,
  serverReportsConnections: serverConnections,
  connectP50Ms: Math.round(percentile(sortedConnect, 50)),
  connectP95Ms: Math.round(percentile(sortedConnect, 95)),
  messagesSent: sent,
  deliveriesExpected: expected,
  deliveriesReceived: received,
  deliveredPercent: Number(((received / expected) * 100).toFixed(2)),
  latencyP50Ms: percentile(sorted, 50),
  latencyP95Ms: percentile(sorted, 95),
  latencyP99Ms: percentile(sorted, 99),
  latencyMaxMs: sorted.at(-1),
  errorEvents: errors,
  serverRssMB: Math.round(rss / 1_048_576),
});

live.forEach((c) => c.ws.close());
await prisma.message.deleteMany({ where: { roomId, createdAt: { gt: new Date(stopAt - (durationSec + 30) * 1000) } } });
await prisma.$disconnect();
