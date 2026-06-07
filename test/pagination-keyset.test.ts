import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseKeyset,
  encodeCursor,
  keysetWhere,
  sliceKeyset,
} from "@/lib/pagination";

test("encodeCursor → parseKeyset round-trips (createdAt, id)", () => {
  const createdAt = new Date("2026-06-01T12:34:56.000Z");
  const token = encodeCursor({ id: "abc123", createdAt });
  const state = parseKeyset({ after: token });
  assert.ok(state.cursor);
  assert.equal(state.cursor!.id, "abc123");
  assert.equal(state.cursor!.createdAt.toISOString(), createdAt.toISOString());
});

test("parseKeyset ignores malformed tokens and returns the first page", () => {
  assert.equal(parseKeyset({ after: "not-base64-$$$" }).cursor, undefined);
  assert.equal(parseKeyset({ after: Buffer.from("nopipe").toString("base64url") }).cursor, undefined);
  assert.equal(parseKeyset({}).cursor, undefined);
});

test("parseKeyset clamps pageSize into bounds", () => {
  assert.equal(parseKeyset({ pageSize: "9999" }).take, 100);
  assert.equal(parseKeyset({ pageSize: "1" }).take, 10);
  assert.equal(parseKeyset({}).take, 25);
});

test("keysetWhere is empty on the first page and a tiebreaking OR after a cursor", () => {
  assert.deepEqual(keysetWhere(undefined), {});
  const at = new Date("2026-06-01T00:00:00.000Z");
  const w = keysetWhere({ id: "x", createdAt: at });
  assert.ok(Array.isArray(w.OR));
  assert.equal(w.OR!.length, 2);
  // older timestamp OR (same timestamp AND smaller id) — the id tiebreak.
  assert.deepEqual(w.OR![0], { createdAt: { lt: at } });
  assert.deepEqual(w.OR![1], { createdAt: at, id: { lt: "x" } });
});

test("sliceKeyset returns no next cursor when the page isn't full", () => {
  const rows = [{ id: "1", createdAt: new Date() }, { id: "2", createdAt: new Date() }];
  const { items, nextCursor } = sliceKeyset(rows, 5);
  assert.equal(items.length, 2);
  assert.equal(nextCursor, null);
});

test("sliceKeyset drops the over-fetched row and emits a next cursor", () => {
  const base = new Date("2026-06-01T00:00:00.000Z");
  const rows = Array.from({ length: 6 }, (_, i) => ({ id: `id${i}`, createdAt: new Date(base.getTime() - i * 1000) }));
  const { items, nextCursor } = sliceKeyset(rows, 5); // asked for 5, fetched 6
  assert.equal(items.length, 5);
  assert.ok(nextCursor);
  // next cursor points at the last returned row, so the next page continues after it.
  const decoded = parseKeyset({ after: nextCursor! });
  assert.equal(decoded.cursor!.id, "id4");
});
