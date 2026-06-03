import { test } from "node:test";
import assert from "node:assert/strict";
import { humanize, localizeDigits, compactMoney, money, toNumber } from "@/lib/format";

test("humanize turns enum constants into Title Case labels", () => {
  assert.equal(humanize("CLOSED_WON"), "Closed Won");
  assert.equal(humanize("NEW"), "New");
  assert.equal(humanize("UNDER_NEGOTIATION"), "Under Negotiation");
});

test("localizeDigits maps ASCII to Urdu digits when locale=ur", () => {
  assert.equal(localizeDigits("2026", "ur"), "۲۰۲۶");
  // English locale is a no-op.
  assert.equal(localizeDigits("2026", "en"), "2026");
});

test("compactMoney returns M/K suffix in en", () => {
  assert.match(compactMoney(15_000_000, "en"), /^PKR 15\.00M$/);
  assert.match(compactMoney(2_500, "en"), /^PKR 2\.5K$/);
});

test("compactMoney uses Urdu digits and روپے suffix in ur", () => {
  const out = compactMoney(15_000_000, "ur");
  assert.ok(/روپے/.test(out), `expected Urdu suffix: ${out}`);
  // Urdu digits ۰-۹
  assert.ok(/[۰-۹]/.test(out), `expected Urdu digits: ${out}`);
});

test("money handles null/undefined as zero", () => {
  assert.equal(money(null), "PKR 0");
  assert.equal(money(undefined), "PKR 0");
});

test("toNumber handles strings, numbers, null", () => {
  assert.equal(toNumber("1234.5"), 1234.5);
  assert.equal(toNumber(42), 42);
  assert.equal(toNumber(null), 0);
  assert.equal(toNumber(undefined), 0);
});
