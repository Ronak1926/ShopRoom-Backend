import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chunk, isTransientConflict, mapWithConcurrency, retryOnConflict } from "./concurrency.js";

const conflict = () => Object.assign(new Error("deadlock"), { code: "P2034" });

describe("retryOnConflict", () => {
  it("returns the first success without retrying", async () => {
    let calls = 0;
    assert.equal(await retryOnConflict(async () => ((calls += 1), "ok")), "ok");
    assert.equal(calls, 1);
  });

  it("retries transient conflicts until one succeeds", async () => {
    let calls = 0;
    const result = await retryOnConflict(
      async () => {
        calls += 1;
        if (calls < 3) throw conflict();
        return "done";
      },
      { baseDelayMs: 1 },
    );
    assert.equal(result, "done");
    assert.equal(calls, 3);
  });

  it("gives up after the configured attempts and throws the last conflict", async () => {
    let calls = 0;
    await assert.rejects(
      retryOnConflict(
        async () => {
          calls += 1;
          throw conflict();
        },
        { attempts: 3, baseDelayMs: 1 },
      ),
      /deadlock/,
    );
    assert.equal(calls, 3);
  });

  it("does not retry other errors", async () => {
    let calls = 0;
    await assert.rejects(
      retryOnConflict(async () => {
        calls += 1;
        throw Object.assign(new Error("unique violation"), { code: "P2002" });
      }),
      /unique violation/,
    );
    assert.equal(calls, 1);
    assert.equal(isTransientConflict(null), false);
    assert.equal(isTransientConflict(new Error("x")), false);
    assert.equal(isTransientConflict(conflict()), true);
  });
});

describe("chunk and mapWithConcurrency", () => {
  it("splits into batches of at most `size`", () => {
    assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    assert.deepEqual(chunk([], 3), []);
  });

  it("never runs more than `limit` at once and keeps result order", async () => {
    let inFlight = 0;
    let peak = 0;
    const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return n * 10;
    });
    assert.deepEqual(results, [10, 20, 30, 40, 50, 60, 70, 80]);
    assert.equal(peak, 3);
  });
});
