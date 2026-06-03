import { test } from "node:test";
import assert from "node:assert/strict";
import { leadHealth } from "@/lib/lead-health";

const now = new Date();
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

test("unassigned lead is always URGENT", () => {
  const r = leadHealth({
    stage: "NEW",
    lastContactedAt: now,
    createdAt: now,
    unassigned: true,
    hasFutureEvent: true,
  });
  assert.equal(r.health, "URGENT");
  assert.ok(r.reasons.includes("Unassigned"));
});

test("fresh NEW lead with future event reads FRESH", () => {
  const r = leadHealth({
    stage: "NEW",
    lastContactedAt: null,
    createdAt: now,
    unassigned: false,
    hasFutureEvent: true,
  });
  assert.equal(r.health, "FRESH");
});

test("fresh NEW lead with no future event reads ATTENTION", () => {
  const r = leadHealth({
    stage: "NEW",
    lastContactedAt: null,
    createdAt: now,
    unassigned: false,
    hasFutureEvent: false,
  });
  assert.equal(r.health, "ATTENTION");
  assert.ok(r.reasons.some((rsn) => rsn.toLowerCase().includes("no follow-up")));
});

test("CONTACTED lead quiet 8 days reads STALE", () => {
  const r = leadHealth({
    stage: "CONTACTED",
    lastContactedAt: daysAgo(8),
    createdAt: daysAgo(30),
    unassigned: false,
    hasFutureEvent: true,
  });
  assert.equal(r.health, "STALE");
});

test("CONTACTED lead quiet beyond 1.5× stale is URGENT", () => {
  const r = leadHealth({
    stage: "CONTACTED",
    lastContactedAt: daysAgo(20),
    createdAt: daysAgo(40),
    unassigned: false,
    hasFutureEvent: true,
  });
  assert.equal(r.health, "URGENT");
});

test("CLOSED_WON is always FRESH regardless of quiet time", () => {
  const r = leadHealth({
    stage: "CLOSED_WON",
    lastContactedAt: daysAgo(365),
    createdAt: daysAgo(400),
    unassigned: false,
    hasFutureEvent: false,
  });
  assert.equal(r.health, "FRESH");
});

test("CLOSED_LOST is always FRESH regardless of quiet time", () => {
  const r = leadHealth({
    stage: "CLOSED_LOST",
    lastContactedAt: daysAgo(365),
    createdAt: daysAgo(400),
    unassigned: false,
    hasFutureEvent: false,
  });
  assert.equal(r.health, "FRESH");
});

test("lastContactedAt takes priority over createdAt when both set", () => {
  // Created long ago, but recently contacted — should be FRESH.
  const r = leadHealth({
    stage: "NEW",
    lastContactedAt: now,
    createdAt: daysAgo(100),
    unassigned: false,
    hasFutureEvent: true,
  });
  assert.equal(r.health, "FRESH");
});
