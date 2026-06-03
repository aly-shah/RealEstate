"use client";

import { useState, useTransition } from "react";
import { aiOwnerWeeklyInsight } from "@/app/(app)/reports/ai-actions";

/**
 * Owner-facing weekly insight on /reports. One button, one result area.
 * Results are cached for 6h server-side so repeated clicks within a
 * morning don't burn budget.
 */
export function OwnerInsightPanel() {
  const [content, setContent] = useState<string>("");
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setError(null);
    startTransition(async () => {
      const result = await aiOwnerWeeklyInsight();
      if (!result.ok) {
        setError(result.reason ?? "AI request failed.");
        setContent("");
        return;
      }
      setContent(result.content ?? "");
      setFromCache(!!result.fromCache);
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn-primary text-sm"
          onClick={run}
          disabled={pending}
        >
          {pending ? "Analysing…" : content ? "Regenerate insight" : "Generate weekly insight"}
        </button>
        {fromCache && content && (
          <span className="chip border-line-soft bg-line-soft text-xs text-muted">cached</span>
        )}
      </div>

      {error && (
        <p className="rounded-lg border border-danger/25 bg-danger-bg px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {!content && !error && (
        <p className="text-sm text-muted">
          Claude reviews week-over-week deltas across leads, visits, deals, revenue and
          overdue payments, then narrates what changed and what to do about it.
        </p>
      )}

      {content && (
        <pre className="whitespace-pre-wrap rounded-lg border border-line-soft bg-line-soft/40 px-4 py-3 text-sm text-ink font-sans">
          {content}
        </pre>
      )}
    </div>
  );
}
