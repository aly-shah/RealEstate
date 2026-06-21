import { test } from "node:test";
import assert from "node:assert/strict";
import { expectedCommission, STAGE_WIN_PROBABILITY } from "@/lib/commissions/forecast";

test("expectedCommission uses the deal's own GCI% when set", () => {
  const r = expectedCommission({ type: "SALE", status: "AGREEMENT", grossPct: 2, value: 10_000_000 });
  // 2% of 10M = 200k gross; AGREEMENT weights at 0.9.
  assert.equal(r.gross, 200_000);
  assert.equal(r.weighted, 180_000);
});

test("expectedCommission falls back to the agency default when GCI% is unset (0)", () => {
  // SALE default is 1%.
  const sale = expectedCommission({ type: "SALE", status: "TOKEN", grossPct: 0, value: 50_000_000 });
  assert.equal(sale.gross, 500_000);
  assert.equal(sale.weighted, 500_000 * STAGE_WIN_PROBABILITY.TOKEN);

  // RENTAL default is 100% (one month's rent) of the monthly-rent value.
  const rent = expectedCommission({ type: "RENTAL", status: "BOOKED", grossPct: 0, value: 300_000 });
  assert.equal(rent.gross, 300_000);
  assert.equal(rent.weighted, 300_000 * STAGE_WIN_PROBABILITY.BOOKED);
});

test("expectedCommission weights by stage probability; terminal/unknown stages weight to 0", () => {
  const draft = expectedCommission({ type: "SALE", status: "DRAFT", grossPct: 1, value: 100_000_000 });
  assert.equal(draft.weighted, draft.gross * 0.1);

  // A status not in the pipeline map (e.g. CLOSED_WON) contributes no weighted forecast.
  const closed = expectedCommission({ type: "SALE", status: "CLOSED_WON", grossPct: 1, value: 100_000_000 });
  assert.equal(closed.weighted, 0);
});
