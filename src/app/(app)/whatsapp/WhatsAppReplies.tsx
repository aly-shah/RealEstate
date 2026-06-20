"use client";

import { useState, useTransition } from "react";
import { aiWhatsAppReplies } from "./actions";
import { sendWhatsAppMessage } from "@/app/(app)/leads/whatsapp-actions";
import type { SuggestedReplies } from "@/lib/ai/handlers/whatsapp-replies";

const STYLES: { key: keyof SuggestedReplies; label: string }[] = [
  { key: "professional", label: "Professional" },
  { key: "friendly", label: "Friendly" },
  { key: "romanUrdu", label: "Roman Urdu" },
];

/**
 * Copilot suggested replies for a conversation. Generates three editable drafts;
 * sending routes through the linked lead's WhatsApp send (existing QR/Cloud
 * layer). Nothing sends automatically.
 */
export function WhatsAppReplies({ phone }: { phone: string }) {
  const [replies, setReplies] = useState<SuggestedReplies | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [leadId, setLeadId] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentKey, setSentKey] = useState<{ key: string; ok: boolean; text: string } | null>(null);
  const [pending, startGen] = useTransition();
  const [sending, startSend] = useTransition();

  function generate() {
    setError(null);
    setSentKey(null);
    startGen(async () => {
      const r = await aiWhatsAppReplies(phone);
      if (!r.ok || !r.replies) {
        setError(r.reason ?? "AI request failed.");
        return;
      }
      setReplies(r.replies);
      setDrafts({ professional: r.replies.professional, friendly: r.replies.friendly, romanUrdu: r.replies.romanUrdu });
      setLeadId(r.leadId ?? null);
      setFromCache(!!r.fromCache);
    });
  }

  function send(key: string) {
    const body = (drafts[key] ?? "").trim();
    if (!body || !leadId) return;
    setSentKey(null);
    startSend(async () => {
      const r = await sendWhatsAppMessage(leadId, body);
      setSentKey({ key, ok: r.ok, text: r.ok ? "Queued ✓" : r.reason ?? "Send failed." });
    });
  }

  return (
    <div>
      {!replies ? (
        <button type="button" onClick={generate} disabled={pending} className="btn-accent">
          {pending ? "Drafting…" : "✨ Suggest replies"}
        </button>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">AI suggested replies</p>
            <div className="flex items-center gap-2">
              {fromCache && <span className="chip border-line bg-line-soft text-muted">cached</span>}
              <button type="button" onClick={generate} disabled={pending} className="btn-ghost text-xs">
                {pending ? "…" : "Regenerate"}
              </button>
            </div>
          </div>

          {!leadId && (
            <p className="rounded-lg border border-line bg-canvas/50 px-3 py-2 text-xs text-muted">
              This conversation isn&rsquo;t linked to a lead yet, so sending is disabled. The drafts are still editable/copyable.
            </p>
          )}

          {STYLES.map(({ key, label }) => (
            <div key={key} className="rounded-xl border border-line bg-paper p-3">
              <p className="mb-1.5 text-xs font-semibold text-ink">{label}</p>
              <textarea
                value={drafts[key] ?? ""}
                onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                rows={3}
                className="field text-sm"
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => send(key)}
                  disabled={sending || !leadId || !(drafts[key] ?? "").trim()}
                  className="btn-accent text-xs"
                >
                  {sending ? "Sending…" : "Send"}
                </button>
                {sentKey?.key === key && (
                  <span className={`text-xs ${sentKey.ok ? "text-ok" : "text-danger"}`}>{sentKey.text}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}
