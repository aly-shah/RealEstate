import { getAiClient, AI_DEFAULTS } from "@/lib/ai/client";

/**
 * Phase-9 WhatsApp inbound classifier.
 *
 * Runs WITHOUT going through lib/ai/run.ts because:
 *   - it has no entityId to cache against (the inbound message is the
 *     entity; idempotency is already handled at the job-queue layer
 *     via Meta's wamid).
 *   - the budget gate is platform-level here (no companyId yet when the
 *     phone line isn't claimed — that's literally what the call helps
 *     ops figure out), so the call site enforces a coarser rate-limit
 *     if needed.
 *
 * Output is a small structured JSON object the handler can act on:
 *   { intent, urgency, lead_summary, suggested_pref_type, suggested_pref_area, suggested_budget_pkr }
 *
 * We DON'T use `output_config.format` for structured outputs because that
 * surface only landed in newer Anthropic SDK versions and we want the
 * classifier to work against any SDK shipping `messages.create`. Instead
 * the system prompt instructs Claude to return JSON-only and the parser
 * here tolerates ```json fences``` and surrounding whitespace.
 */

export interface WhatsAppClassification {
  intent:
    | "NEW_ENQUIRY"
    | "FOLLOW_UP"
    | "QUESTION"
    | "OBJECTION"
    | "SCHEDULING"
    | "OFF_TOPIC";
  urgency: "LOW" | "MEDIUM" | "HIGH";
  lead_summary: string;
  suggested_pref_type:
    | "RESIDENTIAL"
    | "COMMERCIAL"
    | "PLOT"
    | "APARTMENT"
    | "VILLA"
    | "SHOP"
    | "OFFICE"
    | null;
  suggested_pref_area: string | null;
  suggested_budget_pkr: number | null;
}

const VALID_INTENTS = new Set([
  "NEW_ENQUIRY",
  "FOLLOW_UP",
  "QUESTION",
  "OBJECTION",
  "SCHEDULING",
  "OFF_TOPIC",
] as const);
const VALID_URGENCIES = new Set(["LOW", "MEDIUM", "HIGH"] as const);
const VALID_TYPES = new Set([
  "RESIDENTIAL",
  "COMMERCIAL",
  "PLOT",
  "APARTMENT",
  "VILLA",
  "SHOP",
  "OFFICE",
] as const);

const SYSTEM = `You classify inbound WhatsApp messages received by a Pakistani real-estate brokerage.

Respond with a single JSON object. No prose, no Markdown, no code fences — JSON only.

The object MUST have exactly these keys:
  intent: one of NEW_ENQUIRY, FOLLOW_UP, QUESTION, OBJECTION, SCHEDULING, OFF_TOPIC
  urgency: one of LOW, MEDIUM, HIGH
  lead_summary: string, one sentence, <= 140 chars
  suggested_pref_type: one of RESIDENTIAL, COMMERCIAL, PLOT, APARTMENT, VILLA, SHOP, OFFICE, or null
  suggested_pref_area: string or null
  suggested_budget_pkr: integer or null

Field rules:
- intent: NEW_ENQUIRY for first-touch property interest; FOLLOW_UP if they reference a prior conversation; QUESTION for info requests; OBJECTION for price/quality pushback; SCHEDULING for visit/meeting requests; OFF_TOPIC for anything not related to property.
- urgency: HIGH for "today", "ASAP", "tomorrow morning"; MEDIUM for "this week" or "looking to move soon"; LOW for casual browsing.
- lead_summary: plain English description of what the sender wants.
- suggested_pref_type: infer if mentioned; null if unclear. Never invent new types.
- suggested_pref_area: text area name if mentioned (e.g. "DHA Phase 5"). Null if unclear.
- suggested_budget_pkr: integer PKR if mentioned. Parse "2 crore" as 20000000, "50 lakh" as 5000000. Null if unclear.

Never invent details not present in the message.`;

export async function classifyInboundWhatsApp(
  text: string,
): Promise<WhatsAppClassification | null> {
  const client = getAiClient();
  if (!client) return null;

  const trimmed = text.slice(0, 800);
  if (!trimmed.trim()) return null;

  let resp;
  try {
    resp = await client.messages.create({
      ...AI_DEFAULTS,
      max_tokens: 400,
      system: [
        { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
      ],
      messages: [
        { role: "user", content: `Classify this inbound WhatsApp message:\n\n${trimmed}` },
      ],
    });
  } catch {
    // Webhook handlers must not throw — the caller logs the raw payload
    // and continues. Returning null falls back to "unclassified inbound".
    return null;
  }

  // Walk the response content. Skip thinking blocks (the AI defaults
  // enable adaptive thinking; on Opus 4.7 thinking content is omitted by
  // default but on older models it may be present and we don't want to
  // parse it as JSON).
  const text_out = resp.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
  if (!text_out) return null;

  const parsed = tolerantJsonParse(text_out);
  if (!parsed || typeof parsed !== "object") return null;

  return validateClassification(parsed as Record<string, unknown>);
}

/**
 * Extract the first JSON object from the response. Handles three shapes:
 *   1. Bare `{...}` — most common with our explicit prompt.
 *   2. ```json\n{...}\n``` fenced block — model occasionally adds fences.
 *   3. Prose `Sure! Here's the JSON: {...}` — last-resort regex pull.
 * Returns null on any parse failure rather than throwing.
 *
 * Exported so test/whatsapp-classify.test.ts can exercise the parser
 * without needing an Anthropic client; not part of any UI surface.
 */
export function tolerantJsonParse(raw: string): unknown {
  // 1. Direct parse.
  try {
    return JSON.parse(raw);
  } catch {
    /* fall through */
  }
  // 2. Strip ``` fences if present.
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1]);
    } catch {
      /* fall through */
    }
  }
  // 3. First {...} block in the string.
  const objMatch = raw.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      return JSON.parse(objMatch[0]);
    } catch {
      /* fall through */
    }
  }
  return null;
}

/**
 * Coerce + validate every field. Unknown enum values fall back to safe
 * defaults so a model hallucinating "MAYBE" for urgency doesn't crash
 * the handler — better to log a useless-but-valid classification than
 * drop the whole message.
 *
 * Exported for tests; see tolerantJsonParse note above.
 */
export function validateClassification(obj: Record<string, unknown>): WhatsAppClassification | null {
  const intent = typeof obj.intent === "string" && VALID_INTENTS.has(obj.intent as never)
    ? (obj.intent as WhatsAppClassification["intent"])
    : "OFF_TOPIC";
  const urgency = typeof obj.urgency === "string" && VALID_URGENCIES.has(obj.urgency as never)
    ? (obj.urgency as WhatsAppClassification["urgency"])
    : "LOW";
  const lead_summary = typeof obj.lead_summary === "string"
    ? obj.lead_summary.slice(0, 140)
    : "";
  const suggested_pref_type =
    typeof obj.suggested_pref_type === "string" && VALID_TYPES.has(obj.suggested_pref_type as never)
      ? (obj.suggested_pref_type as WhatsAppClassification["suggested_pref_type"])
      : null;
  const suggested_pref_area =
    typeof obj.suggested_pref_area === "string" && obj.suggested_pref_area.trim()
      ? obj.suggested_pref_area.slice(0, 80)
      : null;
  const suggested_budget_pkr =
    typeof obj.suggested_budget_pkr === "number" && Number.isFinite(obj.suggested_budget_pkr)
      ? Math.round(obj.suggested_budget_pkr)
      : null;

  if (!lead_summary) return null;
  return {
    intent,
    urgency,
    lead_summary,
    suggested_pref_type,
    suggested_pref_area,
    suggested_budget_pkr,
  };
}
