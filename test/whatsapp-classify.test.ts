import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tolerantJsonParse,
  validateClassification,
} from "@/lib/ai/handlers/whatsapp-classify";

test("tolerantJsonParse handles bare JSON", () => {
  const out = tolerantJsonParse('{"a": 1}');
  assert.deepEqual(out, { a: 1 });
});

test("tolerantJsonParse strips ```json fences", () => {
  const raw = '```json\n{"intent": "NEW_ENQUIRY"}\n```';
  assert.deepEqual(tolerantJsonParse(raw), { intent: "NEW_ENQUIRY" });
});

test("tolerantJsonParse strips bare ``` fences", () => {
  const raw = "```\n{\"x\":42}\n```";
  assert.deepEqual(tolerantJsonParse(raw), { x: 42 });
});

test("tolerantJsonParse extracts JSON from prose preamble", () => {
  const raw = 'Sure! Here you go: {"intent":"QUESTION","urgency":"LOW"}';
  assert.deepEqual(tolerantJsonParse(raw), { intent: "QUESTION", urgency: "LOW" });
});

test("tolerantJsonParse returns null on garbage", () => {
  assert.equal(tolerantJsonParse("not json"), null);
  assert.equal(tolerantJsonParse(""), null);
});

test("validateClassification fills safe defaults for hallucinated enums", () => {
  const out = validateClassification({
    intent: "MAYBE", // invalid
    urgency: "WHATEVER", // invalid
    lead_summary: "Buyer asking about DHA Phase 5 plots, 1 kanal",
    suggested_pref_type: "MANSION", // invalid
    suggested_pref_area: "DHA Phase 5",
    suggested_budget_pkr: 50_000_000,
  });
  assert.ok(out);
  assert.equal(out!.intent, "OFF_TOPIC");
  assert.equal(out!.urgency, "LOW");
  assert.equal(out!.suggested_pref_type, null);
  assert.equal(out!.suggested_pref_area, "DHA Phase 5");
  assert.equal(out!.suggested_budget_pkr, 50_000_000);
});

test("validateClassification returns null without a lead_summary", () => {
  const out = validateClassification({
    intent: "NEW_ENQUIRY",
    urgency: "HIGH",
  });
  assert.equal(out, null);
});

test("validateClassification rounds budgets to integers", () => {
  const out = validateClassification({
    intent: "NEW_ENQUIRY",
    urgency: "MEDIUM",
    lead_summary: "Looking for an apartment in Karachi.",
    suggested_pref_type: "APARTMENT",
    suggested_pref_area: null,
    suggested_budget_pkr: 12_345_678.9,
  });
  assert.ok(out);
  assert.equal(out!.suggested_budget_pkr, 12_345_679);
});

test("validateClassification trims overlong lead summaries", () => {
  const long = "x".repeat(500);
  const out = validateClassification({
    intent: "NEW_ENQUIRY",
    urgency: "LOW",
    lead_summary: long,
  });
  assert.ok(out);
  assert.equal(out!.lead_summary.length, 140);
});
