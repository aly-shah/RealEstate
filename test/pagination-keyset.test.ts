import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseKeyset,
  encodeCursor,
  keysetWhere,
  keysetOrderBy,
  sliceKeyset,
} from "@/lib/pagination";

const TS = new Date("2026-06-01T12:34:56.000Z");

test("encodeCursor → parseKeyset(after) round-trips (sortValue, id), forward", () => {
  const token = encodeCursor("abc123", TS);
  const p = parseKeyset({ after: token });
  assert.equal(p.direction, "forward");
  assert.ok(p.cursor);
  assert.equal(p.cursor!.id, "abc123");
  assert.equal(p.cursor!.ts.toISOString(), TS.toISOString());
});

test("parseKeyset(before) decodes a backward cursor", () => {
  const token = encodeCursor("xyz", TS);
  const p = parseKeyset({ before: token });
  assert.equal(p.direction, "backward");
  assert.equal(p.cursor!.id, "xyz");
});

test("parseKeyset ignores malformed tokens and returns the forward first page", () => {
  assert.equal(parseKeyset({ after: "not-base64-$$$" }).cursor, undefined);
  assert.equal(parseKeyset({ after: Buffer.from("nopipe").toString("base64url") }).cursor, undefined);
  const first = parseKeyset({});
  assert.equal(first.cursor, undefined);
  assert.equal(first.direction, "forward");
});

test("parseKeyset clamps pageSize into bounds", () => {
  assert.equal(parseKeyset({ pageSize: "9999" }).take, 100);
  assert.equal(parseKeyset({ pageSize: "1" }).take, 10);
  assert.equal(parseKeyset({}).take, 25);
});

test("keysetWhere: empty on first page; lt-tiebreak forward; gt-tiebreak backward", () => {
  assert.deepEqual(keysetWhere({ take: 25, direction: "forward" }, "updatedAt"), {});
  const fwd = keysetWhere({ take: 25, cursor: { id: "x", ts: TS }, direction: "forward" }, "updatedAt");
  assert.deepEqual(fwd.OR, [{ updatedAt: { lt: TS } }, { updatedAt: TS, id: { lt: "x" } }]);
  const back = keysetWhere({ take: 25, cursor: { id: "x", ts: TS }, direction: "backward" }, "updatedAt");
  assert.deepEqual(back.OR, [{ updatedAt: { gt: TS } }, { updatedAt: TS, id: { gt: "x" } }]);
});

test("keysetOrderBy: forward DESC, backward ASC, with id tiebreak on the same field", () => {
  assert.deepEqual(keysetOrderBy({ take: 25, direction: "forward" }, "updatedAt"), [
    { updatedAt: "desc" },
    { id: "desc" },
  ]);
  assert.deepEqual(keysetOrderBy({ take: 25, direction: "backward" }, "updatedAt"), [
    { updatedAt: "asc" },
    { id: "asc" },
  ]);
});

const mk = (i: number) => ({ id: `id${i}`, updatedAt: new Date(TS.getTime() - i * 1000) });
const getTs = (r: { updatedAt: Date }) => r.updatedAt;

test("forward first page: no prev; next set only when an extra row exists", () => {
  const params = { take: 5, direction: "forward" as const };
  const rows = Array.from({ length: 6 }, (_, i) => mk(i)); // 5 + 1 extra
  const { items, prevCursor, nextCursor } = sliceKeyset(rows, params, getTs);
  assert.equal(items.length, 5);
  assert.equal(prevCursor, null); // first page
  assert.ok(nextCursor);
  // next cursor points at the last displayed (oldest) row → continues after it
  assert.equal(parseKeyset({ after: nextCursor! }).cursor!.id, "id4");
});

test("forward last page (no extra): next null, prev set because we arrived via a cursor", () => {
  const params = { take: 5, cursor: { id: "id0", ts: TS }, direction: "forward" as const };
  const rows = Array.from({ length: 3 }, (_, i) => mk(i + 1)); // fewer than take
  const { items, prevCursor, nextCursor } = sliceKeyset(rows, params, getTs);
  assert.equal(items.length, 3);
  assert.equal(nextCursor, null);
  assert.ok(prevCursor); // newest displayed → page back
  assert.equal(parseKeyset({ before: prevCursor! }).cursor!.id, "id1");
});

test("backward page reverses ASC scan to DESC display; next always set", () => {
  const params = { take: 3, cursor: { id: "id0", ts: TS }, direction: "backward" as const };
  // ASC scan returns oldest-of-the-newer first; simulate 4 rows (3 + extra)
  const ascRows = [mk(4), mk(3), mk(2), mk(1)]; // ascending updatedAt order in the array
  const { items, prevCursor, nextCursor } = sliceKeyset(ascRows, params, getTs);
  assert.equal(items.length, 3);
  // displayed newest-first: id2, id3, id4 (reversed from the first 3 of the asc scan)
  assert.deepEqual(items.map((r) => r.id), ["id2", "id3", "id4"]);
  assert.ok(nextCursor); // came from older rows → next exists
  assert.ok(prevCursor); // extra row present → more newer rows exist
});
