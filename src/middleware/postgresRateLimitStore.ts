/**
 * middleware/postgresRateLimitStore.ts — A rate-limit store that keeps its
 * counters in Postgres so every API instance shares them.
 *
 * With the default in-memory store each instance counts separately: behind N
 * instances an attacker gets N times the login or OTP guesses. The database is
 * already shared by every instance, so using it needs no new infrastructure.
 * Each hit costs one small atomic upsert, which is fine for credential, OTP
 * and payment endpoints but not meant for the high-volume global limiter.
 *
 * Time comes from the database clock, so instances with drifting clocks agree.
 */

import type { ClientRateLimitInfo, Options, Store } from "express-rate-limit";
import { prisma } from "../database/prisma.js";

/*
 * Instants cross the driver as epoch milliseconds (extract(epoch …) * 1000), not as
 * timestamps: raw queries render a timestamptz in the database session's time zone
 * and the client then misreads it, shifting it by that zone's offset.
 */
export class PostgresRateLimitStore implements Store {
  /** Counters live in the database, not in this process. */
  readonly localKeys = false;
  private windowMs = 60_000;

  /** `prefix` keeps limiters that share a key shape (say, an IP) from sharing a counter. */
  constructor(readonly prefix: string) {}

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  private key(clientKey: string): string {
    return `${this.prefix}:${clientKey}`;
  }

  async increment(clientKey: string): Promise<ClientRateLimitInfo> {
    const [row] = await prisma.$queryRaw<{ hits: number; resetMs: number }[]>`
      INSERT INTO "RateLimitCounter" ("key", "hits", "resetAt")
      VALUES (${this.key(clientKey)}, 1, now() + (${this.windowMs}::int * interval '1 millisecond'))
      ON CONFLICT ("key") DO UPDATE SET
        "hits" = CASE WHEN "RateLimitCounter"."resetAt" <= now() THEN 1 ELSE "RateLimitCounter"."hits" + 1 END,
        "resetAt" = CASE WHEN "RateLimitCounter"."resetAt" <= now()
                         THEN now() + (${this.windowMs}::int * interval '1 millisecond')
                         ELSE "RateLimitCounter"."resetAt" END
      RETURNING "hits", (extract(epoch from "resetAt") * 1000)::float8 AS "resetMs"`;
    return { totalHits: row.hits, resetTime: new Date(Math.round(row.resetMs)) };
  }

  async get(clientKey: string): Promise<ClientRateLimitInfo | undefined> {
    const [row] = await prisma.$queryRaw<{ hits: number; resetMs: number }[]>`
      SELECT "hits", (extract(epoch from "resetAt") * 1000)::float8 AS "resetMs"
      FROM "RateLimitCounter" WHERE "key" = ${this.key(clientKey)} AND "resetAt" > now()`;
    return row ? { totalHits: row.hits, resetTime: new Date(Math.round(row.resetMs)) } : undefined;
  }

  async decrement(clientKey: string): Promise<void> {
    await prisma.$executeRaw`
      UPDATE "RateLimitCounter" SET "hits" = GREATEST("hits" - 1, 0)
      WHERE "key" = ${this.key(clientKey)} AND "resetAt" > now()`;
  }

  async resetKey(clientKey: string): Promise<void> {
    await prisma.rateLimitCounter.deleteMany({ where: { key: this.key(clientKey) } });
  }

  async resetAll(): Promise<void> {
    await prisma.rateLimitCounter.deleteMany({ where: { key: { startsWith: `${this.prefix}:` } } });
  }
}
