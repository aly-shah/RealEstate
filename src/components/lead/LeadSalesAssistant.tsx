"use client";

import { useState, useTransition } from "react";
import { aiLeadSalesPlan } from "@/app/(app)/leads/ai-actions";
import { sendWhatsAppMessage } from "@/app/(app)/leads/whatsapp-actions";
import type { LeadSalesPlan } from "@/lib/ai/handlers/lead-sales-plan";

/**
 * AI Sales Assistant panel (lead detail right rail). On demand, fetches a cached
 * AI conversion plan and shows the probability, why, the next best actions, and
 * an editable suggested message the agent can send straight to WhatsApp.
 */
export function LeadSalesAssistant({ leadId }: { leadId: string }) {
  const [plan, setPlan] = useState<LeadSalesPlan | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [sendState, setSendState] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startGen] = useTransition();
  const [sending, startSend] = useTransition();

  function generate() {
    setError(null);
    setSendState(null);
    startGen(async () => {
      const r = await aiLeadSalesPlan(leadId);
      if (!r.ok || !r.plan) {
        setError(r.reason ?? "AI request failed.");
        return;
      }
      setPlan(r.plan);
      setFromCache(!!r.fromCache);
      setMsg(r.plan.suggestedMessage);
    });
  }

  function send() {
    if (!msg.trim()) return;
    setSendState(null);
    startSend(async () => {
      const r = await sendWhatsAppMessage(leadId, msg.trim());
      setSendState(r.ok ? { ok: true, text: "Queued — sends on the next tick." } : { ok: false, text: r.reason ?? "Send failed." });
    });
  }

  const lvl = (v: string) => (v === "HIGH" ? "text-danger" : v === "MEDIUM" ? "text-warn" : "text-ok");

  if (!plan) {
    return (
      <div>
        <button type="button" onClick={generate} disabled={pending} className="btn-accent w-full justify-center">
          {pending ? "Analyzing…" : "Analyze this lead"}
        </button>
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Conversion probability */}
      <div>
        <div className="flex items-end justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Conversion chance</span>
          <span className="text-2xl font-bold leading-none text-ink">{plan.conversionProbability}%</span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-line-soft">
          <div className="h-full rounded-full brand-gradient" style={{ width: `${plan.conversionProbability}%` }} />
        </div>
        <div className="mt-2 flex gap-3 text-xs">
          <span>Urgency: <span className={`font-semibold ${lvl(plan.urgency)}`}>{plan.urgency}</span></span>
          <span>Risk: <span className={`font-semibold ${lvl(plan.risk)}`}>{plan.risk}</span></span>
          {fromCache && <span className="ms-auto chip border-line bg-line-soft text-muted">cached</span>}
        </div>
      </div>

      {plan.reasons.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Why</p>
          <ul className="space-y-0.5 text-sm text-slate">
            {plan.reasons.map((r, i) => <li key={i}>• {r}</li>)}
          </ul>
        </div>
      )}

      {plan.nextActions.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Next best actions</p>
          <ol className="space-y-0.5 text-sm text-ink">
            {plan.nextActions.map((a, i) => <li key={i}>{i + 1}. {a}</li>)}
          </ol>
        </div>
      )}

      {/* Suggested message → editable → send */}
      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Suggested message</p>
        <textarea
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          rows={4}
          className="field text-sm"
          placeholder="The AI will draft a message here…"
        />
        <div className="mt-2 flex items-center gap-2">
          <button type="button" onClick={send} disabled={sending || !msg.trim()} className="btn-accent">
            {sending ? "Sending…" : "Send on WhatsApp"}
          </button>
          <button type="button" onClick={generate} disabled={pending} className="btn-ghost text-xs">
            {pending ? "…" : "Regenerate"}
          </button>
        </div>
        {sendState && <p className={`mt-2 text-xs ${sendState.ok ? "text-ok" : "text-danger"}`}>{sendState.text}</p>}
      </div>
    </div>
  );
}
