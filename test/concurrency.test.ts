import { test } from "node:test";
import assert from "node:assert/strict";
import { casUpdate, casUpdateGuarded, ConcurrentUpdateError } from "@/lib/concurrency";

/** Fake Prisma delegate capturing the args and returning a scripted count. */
function fakeDelegate(count: number) {
  const calls: { where: Record<string, unknown>; data: Record<string, unknown> }[] = [];
  return {
    calls,
    updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      calls.push(args);
      return { count };
    },
  };
}

test("casUpdate succeeds when the version matches (count=1) and bumps version", async () => {
  const d = fakeDelegate(1);
  await casUpdate(d, "id1", "co1", 3, { status: "APPROVED" });
  assert.equal(d.calls.length, 1);
  assert.deepEqual(d.calls[0].where, { id: "id1", companyId: "co1", version: 3 });
  assert.deepEqual(d.calls[0].data, { status: "APPROVED", version: { increment: 1 } });
});

test("casUpdate throws ConcurrentUpdateError when nothing matched (count=0)", async () => {
  const d = fakeDelegate(0);
  await assert.rejects(
    () => casUpdate(d, "id1", "co1", 3, { status: "APPROVED" }),
    (e) => e instanceof ConcurrentUpdateError,
  );
});

test("casUpdateGuarded returns true when the predicate matched", async () => {
  const d = fakeDelegate(1);
  const ok = await casUpdateGuarded(d, { id: "x", companyId: "c", status: "PENDING_APPROVAL" }, { status: "APPROVED" });
  assert.equal(ok, true);
  assert.deepEqual(d.calls[0].data, { status: "APPROVED", version: { increment: 1 } });
});

test("casUpdateGuarded returns false when the state already moved (count=0)", async () => {
  const d = fakeDelegate(0);
  const ok = await casUpdateGuarded(d, { id: "x", companyId: "c", status: "PENDING_APPROVAL" }, { status: "APPROVED" });
  assert.equal(ok, false);
});
