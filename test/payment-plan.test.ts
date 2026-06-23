import { test } from "node:test";
import assert from "node:assert/strict";
import { expandSchedule, addMonths, totalPct } from "@/lib/payment-plan";

const START = new Date("2026-01-15T00:00:00.000Z");

test("expandSchedule splits a single milestone into one payment", () => {
  const s = expandSchedule(10_000_000, START, [
    { label: "Booking", pct: 10, type: "BOOKING", count: 1, firstDueMonths: 0, intervalMonths: 1 },
  ]);
  assert.equal(s.length, 1);
  assert.equal(s[0].amount, 1_000_000);
  assert.equal(s[0].label, "Booking");
  assert.equal(s[0].dueDate.getTime(), START.getTime());
});

test("expandSchedule spreads an installment milestone across months and sums exactly", () => {
  const s = expandSchedule(10_000_000, START, [
    { label: "Installment", pct: 30, type: "INSTALMENT", count: 3, firstDueMonths: 1, intervalMonths: 1 },
  ]);
  assert.equal(s.length, 3);
  // 30% of 10M = 3,000,000 split 3 ways = 1,000,000 each.
  assert.equal(s.reduce((a, p) => a + p.amount, 0), 3_000_000);
  assert.equal(s[0].label, "Installment 1/3");
  assert.equal(s[0].dueDate.getTime(), addMonths(START, 1).getTime());
  assert.equal(s[2].dueDate.getTime(), addMonths(START, 3).getTime());
});

test("expandSchedule pushes rounding remainder onto the last payment", () => {
  // 100% of 100 across 3 → 33.33, 33.33, 33.34 = 100 exactly.
  const s = expandSchedule(100, START, [
    { label: "x", pct: 100, type: "INSTALMENT", count: 3, firstDueMonths: 0, intervalMonths: 1 },
  ]);
  assert.equal(s.reduce((a, p) => a + p.amount, 0), 100);
  assert.notEqual(s[2].amount, s[0].amount);
});

test("totalPct sums milestone percentages", () => {
  assert.equal(totalPct([{ pct: 10 }, { pct: 10 }, { pct: 80 }]), 100);
});
