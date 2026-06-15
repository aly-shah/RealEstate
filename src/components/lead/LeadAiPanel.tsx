"use client";

import { useState, useTransition } from "react";
import { aiSuggestLeadNextAction, aiDraftLeadReply, aiLeadBrief } from "@/app/(app)/leads/ai-actions";

interface Props {
  leadId: string;
}

type Mode = "ACTION" | "REPLY" | "BRIEF";

/**
 * Phase-9 AI assistant panel on the lead detail page. Two buttons, one
 * result area — keeps the surface narrow so agents understand what each
 * action does. State lives in this component (no server round-trip to
 * change tabs); both server actions stream their response back here.
 *
 * Cache hits land instantly and are flagged with a small "cached" pill so
 * the agent knows they're seeing the same suggestion as before — clicking
 * the other button (or "Regenerate" via the steering box) forces a fresh
 * call.
 */
export function LeadAiPanel({ leadId }: Props) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [content, setContent] = useState<string>("");
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [steer, setSteer] = useState("");
  const [pending, startTransition] = useTransition();

  function run(next: Mode, steering?: string) {
    setError(null);
    startTransition(async () => {
      const fn = next === "ACTION"
        ? () => aiSuggestLeadNextAction(leadId)
        : next === "BRIEF"
          ? () => aiLeadBrief(leadId)
          : () => aiDraftLeadReply(leadId, steering);
      const result = await fn();
      if (!result.ok) {
        setError(result.reason ?? "AI request failed.");
        setContent("");
        return;
      }
      setMode(next);
      setContent(result.content ?? "");
      setFromCache(!!result.fromCache);
    });
  }

  async function copy() {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      // Silent fallback — older browsers without clipboard access.
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-ghost text-xs"
          disabled={pending}
          onClick={() => run("ACTION")}
        >
          {pending && mode === "ACTION" ? "Thinking…" : "Suggest next action"}
        </button>
        <button
          type="button"
          className="btn-ghost text-xs"
          disabled={pending}
          onClick={() => run("REPLY")}
        >
          {pending && mode === "REPLY" ? "Drafting…" : "Draft WhatsApp reply"}
        </button>
        <button
          type="button"
          className="btn-ghost text-xs"
          disabled={pending}
          onClick={() => run("BRIEF")}
        >
          {pending && mode === "BRIEF" ? "Reading…" : "Conversation brief"}
        </button>
      </div>

      {error && (
        <p className="rounded-lg border border-danger/25 bg-danger-bg px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      {content && mode && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">
              {mode === "ACTION" ? "Suggested next action" : mode === "BRIEF" ? "Conversation brief" : "Draft reply"}
            </span>
            {fromCache && (
              <span className="chip border-line-soft bg-line-soft text-xs text-muted">cached</span>
            )}
          </div>
          <pre className="whitespace-pre-wrap rounded-lg border border-line-soft bg-line-soft/40 px-3 py-2 text-xs text-ink font-sans">
            {content}
          </pre>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={copy}>
              Copy
            </button>
            {mode === "REPLY" && (
              <button
                type="button"
                className="btn-ghost px-2 py-1 text-xs"
                disabled={pending}
                onClick={() => run("REPLY", steer || undefined)}
              >
                Regenerate
              </button>
            )}
          </div>
          {mode === "REPLY" && (
            <input
              type="text"
              value={steer}
              onChange={(e) => setSteer(e.target.value)}
              placeholder="Optional: steer the next draft (e.g. 'focus on budget concern')"
              className="field text-xs"
              maxLength={240}
            />
          )}
        </div>
      )}

      {!content && !error && (
        <p className="text-xs text-muted">
          AI reads this lead&rsquo;s stage, message history and preferences — get a conversation
          brief, the next best action, or a personalised WhatsApp reply.
        </p>
      )}
    </div>
  );
}
