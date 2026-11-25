# Performance and scalability

What was measured, what was found and fixed, what the limits are, and how to repeat it. Read the caveats before quoting any number.

## Caveats

All measurements below ran on one developer laptop: the API, Postgres, the load generator and Chrome shared the same CPU and memory, over loopback (no network latency, no TLS). Firebase was replaced by a stub that answers instantly. The numbers are good for **finding bugs and comparing before/after**; they are not a capacity plan. Repeat them on production-like hardware before launch.

## What the load tests found and fixed

| Finding | Evidence | Fix |
| --- | --- | --- |
| Deadlock persisting push results on large sends | 50,000-device send failed with a Postgres deadlock (P2034); 5,000 passed by luck | Recipient status updates and dead-device deletion run in two phases instead of interleaved; transient conflicts retry (`utils/concurrency.ts`) |
| Missing index on a cascading foreign key | After the deadlock fix, the same send hit the 30 s statement timeout deleting 5,000 dead devices: each delete scanned the whole recipient table | Index on `NotificationSendRecipient.deviceId` |
| Missing indexes on `Message.replyToId`, `customerId`, `shopkeeperId` | Deleting messages in the 500,000-row table timed out; account deletion would hit the same | Indexes added |
| Presence broadcast storm | 500 members joining a room at once made chat delivery p95 **1.4–2.9 s** (p99 up to 4 s) for several seconds, because every join sent the whole online list to the whole room | Broadcasts coalesced to one per room per 500 ms: p95 **19 ms** |
| Discovery, map and member list loaded entire tables per request | Code review (`discoverRooms` read every room and sorted in memory) | Rewritten to filter, sort and page in the database; caps on pins and members |
| No connection acquire timeout | Pool exhaustion would hang requests forever | Explicit pool limits and timeouts, tested |

## Results

Data set (`scripts/loadtest/seedPerf.sql`): 2,000 shops and rooms, 200,000 customers with one device each, about 600,000 memberships, 500,000 messages.

### Notification send (`scripts/loadtest/send.ts`, FCM stubbed)

| Audience | Dead tokens | Time | Throughput | Heap growth | Result |
| --- | --- | --- | --- | --- | --- |
| 5,000 | 10% | 2.0 s | ~2,500 devices/s | +44 MB | sent, 500 dead tokens removed |
| 50,000 (the per-send cap) | 10% | 15.1 s | ~3,300 devices/s | +280 MB (RSS 632 MB) | sent, 5,000 dead tokens removed |

This is our overhead only (audience query, recipient rows, batching into groups of 500, persisting outcomes). Real FCM calls add Google's latency: roughly one round trip per 500 devices, four in flight at a time. Memory grows with audience size; the 50,000 cap bounds it. A send is processed inside the request that triggered it; if sends of this size become common, move dispatch to a background job.

### Live chat (`scripts/loadtest/chat.ts`, Socket.IO over WebSocket)

Members connected to one room, a subset each posting every 2 s; "latency" is send to receipt by every connected member.

| Members | Senders | Deliveries | Delivered | p50 | p95 | p99 | max | Server RSS |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 500 | 25 | 125,000 | 100% | 13 ms | 19 ms | 24 ms | 96 ms | - |
| 1,000 | 50 | 750,000 | 100% | 37 ms | 87 ms | 107 ms | 136 ms | 336 MB |

Connection time at 1,000 members: p95 99 ms, 0 failures. The server's own `socket_connections` metric agreed with the client (1,000). One API process holds the connections in memory; presence is per process (`presenceByRoom`), so running several instances needs a shared adapter (for example the Socket.IO Redis adapter) before rooms can span instances. That is not done.

### Query plans (`scripts/loadtest/explain.sql`)

| Query | Plan | Time |
| --- | --- | --- |
| Discover, most popular | index scan `Room_membersCount_idx` | 0.07 ms |
| Discover, nearest | scans the 2,000 shops, ranks in SQL, top-N | 2 ms (linear in shops: about 100 ms at 100,000) |
| Room members, newest first | `Membership_roomId_joinedAt_idx` | 2 ms |
| Chat history page | `Message_roomId_createdAt_idx` | 0.9 ms |
| Map pins in a bounding box | `Shop_latitude_longitude_idx` | 0.7 ms |
| My rooms | `Membership_customerId_idx` | 0.09 ms |
| Audience for a send (members plus nearby, 200,000 customers) | parallel sequential scan of customers and devices | 154 ms |

The audience query is the slowest; it cannot use the location index because members and nearby strangers are combined with OR. It runs once per send, so 154 ms is fine; at several million customers, split it into two index-friendly queries joined with UNION.

### Images

Through the Cloudinary loader (`src/lib/cloudinaryLoader.ts`): a 110 KB original became 30 KB as a 640 px AVIF card cover and 1.3 KB as a 48 px avatar (about 72% and 99% smaller). Room covers and avatars now use `next/image`.

### Bundle size (`scripts/bundleAudit.mjs`)

First-load JavaScript, uncompressed, before to after moving the notification renderer behind a dynamic import (it was loading on every customer page because the push overlay lives in the customer layout):

| Route | Before | After |
| --- | --- | --- |
| `/customer/home` | 1,023 KB | 825 KB |
| `/customer/room/[roomId]` | 1,404 KB | 1,211 KB |
| `/customer/profile` | 1,145 KB | 952 KB |
| `/customer/login` | 1,140 KB | 946 KB |

Framer Motion and the animation preset catalog are now only on the studio, notification pages, dashboard and the marketing page. The studio is the largest route (1,251 KB) and includes a 395 KB chunk with the image cropper; lazy-loading the crop dialog is the next saving. The script fails the build when a route passes its budget (set in the script).

### Response compression (`src/middleware/compress.ts`)

JSON replies of 1 KB or more are gzipped for clients that accept it, using `node:zlib` (no dependency). A page of 24 notification templates went from 141,863 to 9,925 bytes on the wire (14x smaller), and the whole 95-template catalogue is 519 KB raw and 29 KB gzipped. Replies always carry `Vary: Accept-Encoding`; empty, HEAD, already-encoded and `no-transform` replies are left alone, and `compress.test.ts` covers each case. If a reverse proxy in front of the API already compresses, it skips replies that carry a `Content-Encoding`, so the two do not double up.

## Connection pool

`DB_POOL_MAX` (default 10), `DB_POOL_ACQUIRE_TIMEOUT_MS` (5000; the library default waits forever), `DB_POOL_IDLE_TIMEOUT_MS` (30000), `DB_STATEMENT_TIMEOUT_MS` (30000). Tests show the third caller of a two-connection pool failing in 300 ms instead of hanging, and a runaway query being cancelled at the statement timeout.

Sizing: concurrent demand is requests in flight, plus the scheduler (3 schedules at a time) and a large send (4 write batches at a time). Keep (API instances) x `DB_POOL_MAX` under about 80% of Postgres `max_connections`, and put a pooler (PgBouncer, or the provider's) in front once instances multiply. Raise `DB_POOL_MAX` only if `Unhandled error` entries show acquire timeouts while the database itself is idle.

## Pagination and caching audit

| Endpoint | Bound |
| --- | --- |
| Discover | page and limit (max 30); total and category list from indexed queries |
| Map pins | at most 500, most popular first, `truncated` flag; send a bounding box for the rest |
| Room members | page and limit (default 200, max 500), `total` always the full count |
| Chat history, designs, templates, schedules, send history | already paged |
| Assets | `take` 50 |
| My rooms | capped at 200 |

Cache headers: categories 5 min, template detail 5 min, template list and animation catalog 1 min, send history 15 s (all `private`, with ETags so a revalidation is a 304); everything personal is `no-store`. A test pins this down.

## Rate limiter state

Credential, OTP, sign-up, payment and upload limiters keep their counters in Postgres (`RateLimitCounter`), so every API instance enforces one shared budget; the global backstop and invite preview stay per process. Selected by `RATE_LIMIT_STORE` (`postgres` by default in production, `memory` otherwise). This replaces the Redis item without new infrastructure; if Redis is adopted later for sockets, moving these counters is a one-class change. Verified with two store instances sharing a count, concurrent hits counted exactly, and the live login limiter reading its state from the table.

## Repeating the tests

```sh
# 1. A scratch database whose name contains "test", migrated and seeded
DATABASE_URL=postgresql://…/shoproom_perf_test pnpm exec prisma migrate deploy
psql "postgresql://…/shoproom_perf_test" -f scripts/loadtest/seedPerf.sql
psql "postgresql://…/shoproom_perf_test" -f scripts/loadtest/explain.sql

# 2. Send fan-out (FCM stubbed): audience size, share of dead tokens
TEST_DATABASE_URL=postgresql://…/shoproom_perf_test pnpm exec tsx scripts/loadtest/send.ts 50000 0.1

# 3. Chat: start the API against that database, then connect members
DATABASE_URL=… JWT_SECRET=… METRICS_TOKEN=… PORT=3003 pnpm exec tsx src/index.ts
TEST_DATABASE_URL=… JWT_SECRET=… METRICS_TOKEN=… API_URL=http://localhost:3003 \
  pnpm exec tsx scripts/loadtest/chat.ts 1000 50 30      # members, senders, seconds
# SETTLE_MS=20000 waits longer after joining; the default 1500 ms is the demanding case.
```

Do not point any of these at a real database: they create and delete data.

## How well the tests guard this

Nine of ten deliberate breakages of these controls were caught by a failing test (pool timeout, discover ordering and filtering, member page clamp, rate-limit window and key namespacing, shared-store wiring, conflict retry). The tenth, removing the database-side `take` on map pins, is an equivalent change: the response is still cut to 500 and flagged `truncated`, so only the amount the database reads differs, and no test observes that. A tenth check on the category cache header was interrupted, then verified by hand and by the caching test.

## Not done

- Load test of the notification path against real FCM, or on production-like hardware.
- Multi-instance chat (shared Socket.IO adapter) and a test with several API instances.
- Moving large sends to a background job.
- Lazy-loading the image cropper in the studio.
- The remaining raw `<img>` elements: they are blob previews, HTML strings for map markers, arbitrary stock-photo hosts in the studio, or the shared design renderer, none of which `next/image` suits as is.
