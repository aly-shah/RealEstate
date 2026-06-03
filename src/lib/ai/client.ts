import Anthropic from "@anthropic-ai/sdk";

/**
 * Phase-9 Anthropic Claude client wrapper.
 *
 * Module-scoped singleton so the SDK keeps its connection pool warm across
 * server-action invocations. Fail-closed: when ANTHROPIC_API_KEY isn't set,
 * `getAiClient()` returns null and every AI call site short-circuits to
 * "AI unavailable" — never throws at import time so the rest of the app
 * (UI, server actions that don't touch AI) keeps booting on machines
 * without an API key (CI, local dev for non-AI work).
 */

let _client: Anthropic | null | undefined;

/** Returns the SDK singleton, or null when the API key isn't configured. */
export function getAiClient(): Anthropic | null {
  if (_client !== undefined) return _client;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    _client = null;
    return null;
  }
  _client = new Anthropic({ apiKey: key });
  return _client;
}

/** True when AI features can run on this server. */
export function isAiConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/**
 * The model the whole app uses. Centralised here so a bump is a one-line
 * change. Opus 4.7 is the most capable Claude model — used for every AI
 * surface so the operator gets the best output quality on the small set
 * of calls per tenant per day. Switch to `claude-sonnet-4-6` here if
 * token cost becomes a concern at scale.
 */
export const AI_MODEL = "claude-opus-4-7";

/**
 * Standard message-create options applied to every call. Adaptive thinking
 * lets the model decide when to reason vs. answer directly — important for
 * mixing "draft a one-line reply" (no thinking) with "summarise this lead's
 * history" (some thinking). On Opus 4.7 the thinking *content* is omitted
 * by default which is exactly what we want — we don't surface model
 * reasoning to operators. max_tokens is intentionally tight at 800 to keep
 * responses scannable in the UI and bound cost.
 */
export const AI_DEFAULTS = {
  model: AI_MODEL,
  max_tokens: 800,
  thinking: { type: "adaptive" as const },
} as const;

export type { Anthropic };
