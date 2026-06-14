import { createHash } from "node:crypto";
import type { AiSuggestionType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { aiComplete } from "@/lib/ai/provider";
import { checkAiBudget } from "@/lib/ai/budget";

/**
 * Phase-9 single entry point for every AI call.
 *
 * Flow:
 *   1. Budget gate — plan limits + master switch + ANTHROPIC_API_KEY.
 *   2. Cache lookup — hash the canonical inputs; reuse an AiSuggestion row
 *      created within the freshness window so repeated clicks don't burn
 *      budget or Claude tokens.
 *   3. Call Claude — system prompt with prompt-caching breakpoint, single
 *      user turn carrying the runtime data.
 *   4. Persist — write the response to AiSuggestion (which doubles as the
 *      budget counter via lib/ai/budget.ts).
 *
 * Callers pass a typed builder describing the call; this file owns the
 * caching, hashing, persistence, and error shape so handlers stay terse.
 */

export interface AiCallInput {
  companyId: string;
  type: AiSuggestionType;
  entity: { type: string; id: string };
  /**
   * The static, cacheable framing for the call. Goes into the Anthropic
   * `system` array with cache_control so identical system blocks across
   * calls hit Anthropic's prompt cache (~90% cheaper on the cached
   * portion). Keep deterministic — no timestamps, no per-request IDs.
   */
  system: string;
  /**
   * The volatile, per-request payload. Goes into the user turn. Whatever
   * you pass here also feeds the input hash that drives DB caching, so
   * include only the fields that actually shape the response — extras
   * cause spurious cache misses.
   */
  inputs: Record<string, unknown>;
  /**
   * The user-turn instruction that prefixes `inputs`. Typically one
   * sentence telling Claude what to produce ("Suggest the next action…").
   */
  prompt: string;
  /**
   * Cache freshness in milliseconds. Defaults to 30 min — long enough that
   * "open the lead, look at suggestion, open another tab, come back" all
   * hit cache; short enough that fresh activity (new visit, stage change)
   * naturally invalidates via the input hash within an hour.
   */
  cacheTtlMs?: number;
  /**
   * Cap on response length. Defaults to 800; bump for narrative outputs
   * (owner weekly insight = ~1500).
   */
  maxTokens?: number;
}

export interface AiCallResult {
  ok: true;
  content: string;
  fromCache: boolean;
  usage: { promptTokens: number; completionTokens: number; cachedTokens: number };
}

export interface AiCallFailure {
  ok: false;
  reason: string;
}

export async function runAi(input: AiCallInput): Promise<AiCallResult | AiCallFailure> {
  const budget = await checkAiBudget(input.companyId);
  if (!budget.ok) return { ok: false, reason: budget.reason ?? "AI unavailable." };

  const inputHash = hashInputs({ system: input.system, prompt: input.prompt, inputs: input.inputs });
  const ttlMs = input.cacheTtlMs ?? 30 * 60_000;
  const since = new Date(Date.now() - ttlMs);

  // Cache lookup. The (companyId, type, entityType, entityId) index already
  // narrows to a few rows per lead, so the in-memory hash check is cheap.
  const cached = await prisma.aiSuggestion.findFirst({
    where: {
      companyId: input.companyId,
      type: input.type,
      entityType: input.entity.type,
      entityId: input.entity.id,
      inputHash,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
  });
  if (cached) {
    return {
      ok: true,
      fromCache: true,
      content: cached.content,
      usage: {
        promptTokens: cached.promptTokens,
        completionTokens: cached.completionTokens,
        cachedTokens: cached.cachedTokens,
      },
    };
  }

  // Provider-agnostic call (Anthropic or OpenAI — see lib/ai/provider.ts).
  // Stable framing in `system`, volatile data in the user turn. These outputs
  // are markdown/plain text, so no JSON mode.
  const result = await aiComplete({
    system: input.system,
    user: `${input.prompt}\n\n<context>\n${stringifyInputs(input.inputs)}\n</context>`,
    maxTokens: input.maxTokens ?? 800,
    json: false,
  });
  if (!result.ok) return { ok: false, reason: result.reason };

  const text = result.text;
  if (!text) return { ok: false, reason: "AI returned an empty response." };

  // Cap at 4KB so a runaway response can't blow up the row. The model is
  // told to be concise but the cap is a backstop.
  const content = text.length > 4_000 ? text.slice(0, 4_000) + "\n\n…(truncated)" : text;

  const usage = result.usage;

  await prisma.aiSuggestion.create({
    data: {
      companyId: input.companyId,
      type: input.type,
      entityType: input.entity.type,
      entityId: input.entity.id,
      content,
      inputHash,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      cachedTokens: usage.cachedTokens,
    },
  });

  return { ok: true, fromCache: false, content, usage };
}

/**
 * SHA-256 of the canonical (system, prompt, inputs) tuple. Deterministic
 * JSON serialisation via sortKeys so { a: 1, b: 2 } and { b: 2, a: 1 }
 * collapse to the same hash — JavaScript's iteration order isn't part
 * of the contract callers should rely on.
 */
function hashInputs(parts: { system: string; prompt: string; inputs: Record<string, unknown> }): string {
  const payload = JSON.stringify({
    s: parts.system,
    p: parts.prompt,
    i: parts.inputs,
  }, sortedReplacer);
  return createHash("sha256").update(payload).digest("hex");
}

function sortedReplacer(_key: string, value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.keys(value as object)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = (value as Record<string, unknown>)[k];
        return acc;
      }, {});
  }
  return value;
}

function stringifyInputs(inputs: Record<string, unknown>): string {
  // Render as plain key: value pairs — Claude handles this format better
  // than raw JSON for short structured inputs (we don't need re-parseable
  // round-trip; the model just reads it).
  return Object.entries(inputs)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("\n");
}
