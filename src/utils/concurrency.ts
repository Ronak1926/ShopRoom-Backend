/**
 * utils/concurrency.ts — Small helpers for bounded-parallel batch work.
 */

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Runs `fn` over every item with at most `limit` in flight at once, keeping
 * result order. Unlike a bare Promise.all over thousands of items it cannot
 * flood a downstream API (FCM) or the connection pool.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Prisma's code for "write conflict or deadlock, retry the transaction". */
export function isTransientConflict(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === "P2034";
}

/**
 * Re-runs `fn` when it fails with a transient database conflict (deadlock or
 * serialization failure), waiting a short, growing, jittered delay between
 * attempts. Any other error, or the last conflict, is thrown unchanged.
 */
export async function retryOnConflict<T>(
  fn: () => Promise<T>,
  { attempts = 4, baseDelayMs = 25, shouldRetry = isTransientConflict } = {},
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= attempts || !shouldRetry(err)) throw err;
      const delay = baseDelayMs * 2 ** (attempt - 1) * (0.5 + Math.random());
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
