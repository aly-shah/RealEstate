/**
 * OpenAI client used by the Add-property "Write with AI" copy generator.
 *
 * Raw fetch against the Chat Completions API — no SDK dependency. Fail-closed:
 * returns a clean error when OPENAI_API_KEY isn't set, never throws at import
 * time, so the rest of the app boots on machines without a key.
 *
 * Model is OPENAI_MODEL (default gpt-4o-mini — cheap and more than capable for
 * short listing copy). Uses response_format json_object so the reply is always
 * valid JSON (the prompt must mention "JSON", which our system prompt does).
 */

export const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

export function isOpenAiConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

export type OpenAiResult =
  | { ok: true; text: string; usage: { promptTokens: number; completionTokens: number } }
  | { ok: false; reason: string };

export async function openaiChat(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  /** Force a JSON-object response (response_format). Default false → plain text. */
  json?: boolean;
}): Promise<OpenAiResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { ok: false, reason: "AI features are not configured on this server." };

  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        max_tokens: opts.maxTokens ?? 500,
        temperature: 0.7,
        // JSON mode requires the prompt to mention "JSON"; callers that pass
        // json:true ensure their system prompt does.
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message.slice(0, 200) : "OpenAI request failed." };
  }

  if (!res.ok) {
    // Surface the OpenAI error (rate limit, invalid key, bad model) — operator-actionable.
    const body = await res.text().catch(() => "");
    return { ok: false, reason: `OpenAI error ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}` };
  }

  const data = (await res.json().catch(() => null)) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  } | null;
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    return { ok: false, reason: "OpenAI returned an empty response." };
  }
  return {
    ok: true,
    text,
    usage: {
      promptTokens: data?.usage?.prompt_tokens ?? 0,
      completionTokens: data?.usage?.completion_tokens ?? 0,
    },
  };
}

/** Back-compat wrapper — JSON-forced chat (the original signature). */
export function openaiChatJson(opts: { system: string; user: string; maxTokens?: number }): Promise<OpenAiResult> {
  return openaiChat({ ...opts, json: true });
}
