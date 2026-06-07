import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cachedQuery,
  invalidateTags,
  invalidateKey,
  withTimeout,
  QueryTimeoutError,
  _clearCache,
} from "@/lib/query-optimizer";

const opts = (tags?: string[]) => ({ ttlMs: 1_000, tags });

test("cachedQuery memoizes — fetcher runs once for repeat hits", async () => {
  _clearCache();
  let calls = 0;
  const fetch = async () => { calls++; return 42; };
  assert.equal(await cachedQuery("k1", opts(), fetch), 42);
  assert.equal(await cachedQuery("k1", opts(), fetch), 42);
  assert.equal(calls, 1);
});

test("cachedQuery refetches after TTL expiry", async () => {
  _clearCache();
  let calls = 0;
  const fetch = async () => { calls++; return calls; };
  assert.equal(await cachedQuery("k2", { ttlMs: 5 }, fetch), 1);
  await new Promise((r) => setTimeout(r, 12));
  assert.equal(await cachedQuery("k2", { ttlMs: 5 }, fetch), 2);
  assert.equal(calls, 2);
});

test("invalidateTags evicts every key carrying the tag", async () => {
  _clearCache();
  let calls = 0;
  const fetch = async () => { calls++; return calls; };
  await cachedQuery("a", opts(["co:1:rev"]), fetch);
  await cachedQuery("b", opts(["co:1:rev"]), fetch);
  invalidateTags("co:1:rev");
  await cachedQuery("a", opts(["co:1:rev"]), fetch); // cold again
  assert.equal(calls, 3); // a, b, then a again
});

test("invalidateKey drops a single entry", async () => {
  _clearCache();
  let calls = 0;
  const fetch = async () => { calls++; return calls; };
  await cachedQuery("only", opts(), fetch);
  invalidateKey("only");
  await cachedQuery("only", opts(), fetch);
  assert.equal(calls, 2);
});

test("cachedQuery collapses a stampede into one fetch", async () => {
  _clearCache();
  let calls = 0;
  const fetch = async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return "v"; };
  const [a, b, c] = await Promise.all([
    cachedQuery("hot", opts(), fetch),
    cachedQuery("hot", opts(), fetch),
    cachedQuery("hot", opts(), fetch),
  ]);
  assert.deepEqual([a, b, c], ["v", "v", "v"]);
  assert.equal(calls, 1);
});

test("a throwing fetcher is not cached and does not wedge the key", async () => {
  _clearCache();
  let calls = 0;
  const fetch = async () => { calls++; if (calls === 1) throw new Error("boom"); return "ok"; };
  await assert.rejects(() => cachedQuery("retry", opts(), fetch), /boom/);
  assert.equal(await cachedQuery("retry", opts(), fetch), "ok"); // retried, then cached
  assert.equal(calls, 2);
});

test("withTimeout rejects when the query is too slow", async () => {
  await assert.rejects(
    () => withTimeout(() => new Promise((r) => setTimeout(() => r(1), 50)), 10),
    (e) => e instanceof QueryTimeoutError,
  );
});

test("withTimeout resolves when the query is fast enough", async () => {
  const v = await withTimeout(() => Promise.resolve("quick"), 1_000);
  assert.equal(v, "quick");
});
