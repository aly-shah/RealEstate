"use client";

import { useState, useTransition } from "react";
import { sendWhatsAppMessage, sendWhatsAppTemplate } from "@/app/(app)/leads/whatsapp-actions";

export interface TemplateOption {
  name: string;
  language: string;
  paramCount: number;
  bodyText: string;
  /** TEXT-header body when present; empty for headerless / media-headed templates. */
  headerText?: string | null;
  headerParamCount?: number;
}

interface Props {
  leadId: string;
  /** Pre-filled body — typically the AI-drafted reply. */
  initialBody?: string;
  /** Approved templates available for this tenant (already filtered). */
  templates?: TemplateOption[];
}

type Mode = "text" | "template";

/**
 * Phase-9.5 outbound WhatsApp send panel. Only rendered when the
 * tenant has both `whatsappPhoneId` and `whatsappAccessToken` set
 * — the lead-detail page checks before mounting.
 *
 * Two modes:
 *   - text: free-form (only works inside Meta's 24h customer-service window)
 *   - template: pre-approved template by name + language + body params
 *               (the only path that works outside the window)
 *
 * The action enqueues a job rather than blocking on Meta's API, so
 * the UI returns instantly with "Queued — check the timeline" and
 * the activity log updates within a tick once Meta acks. Send failures
 * are visible in the timeline and at /admin/jobs.
 */
export function WhatsAppSend({ leadId, initialBody = "", templates = [] }: Props) {
  const [mode, setMode] = useState<Mode>("text");
  const [body, setBody] = useState(initialBody);
  // Selected template key — `${name}::${language}` — empty until the
  // operator picks one. Drives both the API call and the parameter
  // input sizing.
  const [templateKey, setTemplateKey] = useState("");
  const [paramsRaw, setParamsRaw] = useState("");
  const [headerParamsRaw, setHeaderParamsRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const [pending, startTransition] = useTransition();

  const selected = templateKey
    ? templates.find((t) => `${t.name}::${t.language}` === templateKey)
    : undefined;

  function submit() {
    setError(null);
    setQueued(false);
    startTransition(async () => {
      const res = mode === "text"
        ? await sendWhatsAppMessage(leadId, body)
        : selected
          ? await sendWhatsAppTemplate(leadId, {
              templateName: selected.name,
              language: selected.language,
              // One parameter per non-empty line — easier UX than a JSON array.
              bodyParams: paramsRaw.split("\n").map((s) => s.trim()).filter(Boolean),
              headerParams: headerParamsRaw.split("\n").map((s) => s.trim()).filter(Boolean),
            })
          : { ok: false as const, reason: "Pick a template first." };
      if (!res.ok) {
        setError(res.reason ?? "Send failed.");
        return;
      }
      setQueued(true);
      if (mode === "text") {
        setBody("");
      } else {
        setParamsRaw("");
        setHeaderParamsRaw("");
      }
    });
  }

  return (
    <div className="space-y-2">
      {/* Mode toggle — two chip-style buttons. */}
      <div className="flex gap-1">
        {(["text", "template"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setError(null);
              setQueued(false);
            }}
            className={`chip text-xs ${
              mode === m
                ? "border-ink bg-ink text-white"
                : "border-line bg-white text-slate hover:border-accent/40 hover:text-accent"
            }`}
          >
            {m === "text" ? "Free text" : "Template"}
          </button>
        ))}
      </div>

      {mode === "text" ? (
        <>
          <textarea
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Type a message or paste the AI draft above…"
            maxLength={1_000}
            className="field text-sm resize-none"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted">{body.length} / 1,000</span>
            <button
              type="button"
              className="btn-accent text-xs"
              onClick={submit}
              disabled={pending || !body.trim()}
            >
              {pending ? "Queueing…" : "Send via WhatsApp"}
            </button>
          </div>
        </>
      ) : templates.length === 0 ? (
        <p className="rounded-lg border border-warn/25 bg-warn-bg px-3 py-2 text-xs text-warn">
          No approved templates available yet. Owner: go to Settings → WhatsApp templates
          and click "Sync templates" to fetch the catalog from Meta.
        </p>
      ) : (
        <>
          <select
            value={templateKey}
            onChange={(e) => {
              setTemplateKey(e.target.value);
              setParamsRaw(""); // reset — different template = different param shape
              setHeaderParamsRaw("");
            }}
            className="field text-sm font-mono"
          >
            <option value="">Pick a template…</option>
            {templates.map((t) => (
              <option key={`${t.name}::${t.language}`} value={`${t.name}::${t.language}`}>
                {t.name} ({t.language}) — {t.paramCount} param{t.paramCount === 1 ? "" : "s"}
              </option>
            ))}
          </select>

          {selected && (
            <>
              {selected.headerText && (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Header</p>
                  <pre className="whitespace-pre-wrap rounded-lg border border-line-soft bg-line-soft/40 px-3 py-2 text-xs text-slate font-sans">
                    {selected.headerText}
                  </pre>
                  {(selected.headerParamCount ?? 0) > 0 && (
                    <textarea
                      rows={Math.min(selected.headerParamCount ?? 0, 3)}
                      value={headerParamsRaw}
                      onChange={(e) => setHeaderParamsRaw(e.target.value)}
                      placeholder={`Header values, one per line — ${selected.headerParamCount} required.`}
                      className="field text-sm resize-none mt-1"
                    />
                  )}
                </div>
              )}
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Body</p>
                <pre className="whitespace-pre-wrap rounded-lg border border-line-soft bg-line-soft/40 px-3 py-2 text-xs text-slate font-sans">
                  {selected.bodyText}
                </pre>
                {selected.paramCount > 0 ? (
                  <textarea
                    rows={Math.min(selected.paramCount, 5)}
                    value={paramsRaw}
                    onChange={(e) => setParamsRaw(e.target.value)}
                    placeholder={`Body values, one per line — ${selected.paramCount} required.`}
                    className="field text-sm resize-none mt-1"
                  />
                ) : (
                  <p className="text-xs text-muted">No body variables — send as-is.</p>
                )}
              </div>
            </>
          )}

          <div className="flex items-center justify-between">
            <span className="text-xs text-muted">
              {selected
                ? `Will substitute {{1}}…{{${selected.paramCount}}} in order.`
                : "Templates synced from Meta Business Manager."}
            </span>
            <button
              type="button"
              className="btn-accent text-xs"
              onClick={submit}
              disabled={(() => {
                if (pending || !selected) return true;
                const bodyN = paramsRaw.split("\n").map((s) => s.trim()).filter(Boolean).length;
                const headerN = headerParamsRaw.split("\n").map((s) => s.trim()).filter(Boolean).length;
                if (selected.paramCount > 0 && bodyN < selected.paramCount) return true;
                if ((selected.headerParamCount ?? 0) > 0 && headerN < (selected.headerParamCount ?? 0)) return true;
                return false;
              })()}
            >
              {pending ? "Queueing…" : "Send template"}
            </button>
          </div>
        </>
      )}

      {error && (
        <p className="rounded-lg border border-danger/25 bg-danger-bg px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}
      {queued && !error && (
        <p className="rounded-lg border border-ok/25 bg-ok-bg px-3 py-2 text-xs text-ok">
          Queued — check the timeline in a minute for delivery status.
        </p>
      )}
      <p className="text-xs text-muted">
        Free text only works inside Meta's 24-hour customer-service window. Use a
        template (or a wa.me link) for cold outreach.
      </p>
    </div>
  );
}
