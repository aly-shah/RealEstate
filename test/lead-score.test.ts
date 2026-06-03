import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreLead } from "@/lib/lead-score";

const now = new Date();
const week = (n: number) => new Date(now.getTime() - n * 86_400_000);

test("a fresh NEW lead with no signals lands in COLD", () => {
  const r = scoreLead({
    stage: "NEW",
    source: "OTHER",
    hasBudget: false,
    hasProperty: false,
    updatedAt: now,
    hasShowing: false,
  });
  assert.equal(r.band, "COLD");
  assert.ok(r.score < 40, `expected <40 score, got ${r.score}`);
});

test("NEGOTIATION + recent + REFERRAL hits HOT", () => {
  const r = scoreLead({
    stage: "NEGOTIATION",
    source: "REFERRAL",
    hasBudget: true,
    hasProperty: true,
    updatedAt: now,
    hasShowing: true,
    topInterest: "HIGH",
  });
  assert.equal(r.band, "HOT");
  assert.equal(r.score, 100); // clamped
});

test("CLOSED_LOST scores 0", () => {
  const r = scoreLead({
    stage: "CLOSED_LOST",
    source: "REFERRAL",
    hasBudget: true,
    hasProperty: true,
    updatedAt: now,
    hasShowing: true,
  });
  assert.equal(r.score, 0);
  assert.equal(r.band, "COLD");
});

test("admin override forces the band but preserves the raw score", () => {
  const r = scoreLead({
    stage: "NEW",
    source: "OTHER",
    hasBudget: false,
    hasProperty: false,
    updatedAt: now,
    hasShowing: false,
    override: "HOT",
  });
  assert.equal(r.band, "HOT");
  assert.equal(r.overridden, true);
  assert.ok(r.score < 40); // raw score unaffected by override
});

test("quiet >14 days penalises the score", () => {
  const fresh = scoreLead({
    stage: "INTERESTED",
    source: "REFERRAL",
    hasBudget: true,
    hasProperty: false,
    updatedAt: now,
    hasShowing: false,
  });
  const stale = scoreLead({
    stage: "INTERESTED",
    source: "REFERRAL",
    hasBudget: true,
    hasProperty: false,
    updatedAt: week(20),
    hasShowing: false,
  });
  assert.ok(stale.score < fresh.score, `stale ${stale.score} should be < fresh ${fresh.score}`);
});

test("NONE interest level subtracts from the score", () => {
  const noneInterest = scoreLead({
    stage: "PROPERTY_SHOWN",
    source: "REFERRAL",
    hasBudget: true,
    hasProperty: true,
    updatedAt: now,
    hasShowing: true,
    topInterest: "NONE",
  });
  const highInterest = scoreLead({
    stage: "PROPERTY_SHOWN",
    source: "REFERRAL",
    hasBudget: true,
    hasProperty: true,
    updatedAt: now,
    hasShowing: true,
    topInterest: "HIGH",
  });
  assert.ok(noneInterest.score < highInterest.score);
});

test("score is always within [0, 100]", () => {
  for (const stage of ["NEW", "NEGOTIATION", "CLOSED_WON"] as const) {
    const r = scoreLead({
      stage,
      source: "REFERRAL",
      hasBudget: true,
      hasProperty: true,
      updatedAt: now,
      hasShowing: true,
      topInterest: "HIGH",
    });
    assert.ok(r.score >= 0 && r.score <= 100, `${stage}: ${r.score} out of range`);
  }
});
