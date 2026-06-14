import { getAiClient, AI_DEFAULTS } from "@/lib/ai/client";
import { isOpenAiConfigured, openaiChat } from "@/lib/ai/openai";

/**
 * Provider abstraction so every AI handler runs on EITHER Anthropic or OpenAI.
 *
 * Selection (activeProvider):
 *   - `AI_PROVIDER=openai|anthropic` forces a provider (when its key is set);
 *   - otherwise prefer Anthropic when ANTHROPIC_API_KEY is set, else fall back
 *     to OpenAI when OPENAI_API_KEY is set;
 *   - null when neither is configured (every call short-circuits to "AI
 *     unavailable", same as before).
 *
 * This lets a deployment run the whole AI surface (lead next-action / reply
 * draft / owner insight / WhatsApp classifier / property copy) on a single
 * OpenAI key, with no Anthropic key required.
 */

export type AiProvider = "anthropic" | "openai";

function hasAnthropicKey(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export function activeProvider(): AiProvider | null {
  const forced = process.env.AI_PROVIDER?.toLowerCase().trim();
  if (forced === "openai") return isOpenAiConfigured() ? "openai" : null;
  if (forced === "anthropic") return hasAnthropicKey() ? "anthropic" : null;
  if (hasAnthropicKey()) return "anthropic";
  if (isOpenAiConfigured()) return "openai";
  return null;
}

/** True when ANY provider can run on this server. Replaces the old
 *  Anthropic-only client.isAiConfigured everywhere the gate is checked. */
export function isAiConfigured(): boolean {
  return activeProvider() !== null;
}

export interface AiUsage {
  promptTokens: number;
  completionTokens: number;
  /** Anthropic prompt-cache hits; always 0 for OpenAI. */
  cachedTokens: number;
}

export type AiCompletion =
  | { ok: true; text: string; usage: AiUsage }
  | { ok: false; reason: string };

/**
 * Provider-agnostic single-shot completion. Anthropic puts the system prompt in
 * a cache_control block (prompt caching); OpenAI uses Chat Completions, with
 * `json: true` forcing a JSON-object response. Returns plain text either way;
 * structured callers parse it themselves.
 */
export async function aiComplete(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  json?: boolean;
}): Promise<AiCompletion> {
  const provider = activeProvider();
  if (!provider) return { ok: false, reason: "AI features are not configured on this server." };

  if (provider === "openai") {
    const r = await openaiChat({
      system: opts.system,
      user: opts.user,
      maxTokens: opts.maxTokens,
      json: opts.json,
    });
    if (!r.ok) return r;
    return {
      ok: true,
      text: r.text.trim(),
      usage: { promptTokens: r.usage.promptTokens, completionTokens: r.usage.completionTokens, cachedTokens: 0 },
    };
  }

  // Anthropic — mirrors the original runAi call (adaptive thinking via
  // AI_DEFAULTS + a prompt-cached system block).
  const client = getAiClient();
  if (!client) return { ok: false, reason: "AI features are not configured on this server." };
  try {
    const resp = await client.messages.create({
      ...AI_DEFAULTS,
      max_tokens: opts.maxTokens ?? AI_DEFAULTS.max_tokens,
      system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: opts.user }],
    });
    const text = resp.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    return {
      ok: true,
      text,
      usage: {
        promptTokens: resp.usage.input_tokens ?? 0,
        completionTokens: resp.usage.output_tokens ?? 0,
        cachedTokens: resp.usage.cache_read_input_tokens ?? 0,
      },
    };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message.slice(0, 240) : "AI request failed." };
  }
}
