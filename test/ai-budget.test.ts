import { test } from "node:test";
import assert from "node:assert/strict";
import { AI_BUDGET } from "@/lib/ai/budget";

/**
 * AI plan-budget sanity. These are commercial commitments — accidentally
 * widening a tier's budget could cost real money, so any change should
 * fail loudly here and trigger a deliberate test update.
 */

test("FREE has no AI access", () => {
  assert.equal(AI_BUDGET.FREE, 0);
});

test("budgets are monotonic non-decreasing along the tier ladder", () => {
  assert.ok(AI_BUDGET.FREE <= AI_BUDGET.TRIAL);
  assert.ok(AI_BUDGET.TRIAL <= AI_BUDGET.STARTER);
  assert.ok(AI_BUDGET.STARTER <= AI_BUDGET.GROWTH);
  assert.ok(AI_BUDGET.GROWTH <= AI_BUDGET.PRO);
});

test("PRO is unlimited", () => {
  assert.equal(Number.isFinite(AI_BUDGET.PRO), false);
});

test("budgets fit the documented numbers", () => {
  assert.equal(AI_BUDGET.FREE, 0);
  assert.equal(AI_BUDGET.TRIAL, 25);
  assert.equal(AI_BUDGET.STARTER, 100);
  assert.equal(AI_BUDGET.GROWTH, 1_000);
});
