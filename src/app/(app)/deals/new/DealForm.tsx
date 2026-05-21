"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { createDeal, type FormState } from "../actions";
import { computeCommission, type CommissionRuleInput } from "@/lib/commission";
import { money, compactMoney } from "@/lib/format";

interface Option { id: string; name: string }
interface PropOption { id: string; title: string; reference: string }

interface DealFormProps {
  properties: PropOption[];
  clients: Option[];
  agents: Option[];
  dealers: Option[];
  rule: CommissionRuleInput;
}

const STEPS = ["Deal", "Money", "Agents", "Review"];

function Err({ state, name }: { state: FormState; name: string }) {
  const msg = state.fieldErrors?.[name]?.[0];
  return msg ? <p className="mt-1 text-xs text-danger">{msg}</p> : null;
}

export function DealForm({ properties, clients, agents, dealers, rule }: DealFormProps) {
  const [step, setStep] = useState(0);
  const [type, setType] = useState<"SALE" | "RENTAL">("SALE");
  const [propertyId, setPropertyId] = useState("");
  const [amount, setAmount] = useState<number>(0);
  const [mainAgentId, setMainAgentId] = useState("");
  const [coAgentIds, setCoAgentIds] = useState<string[]>([]);
  const [dealerId, setDealerId] = useState("");
  const [commRate, setCommRate] = useState(2); // % of value, estimate only

  const [state, action, pending] = useActionState<FormState, FormData>(createDeal, {});

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? "Agent";
  const dealerName = (id: string) => dealers.find((d) => d.id === id)?.name ?? "Dealer";

  // Live commission estimate for the review step.
  const preview = useMemo(() => {
    const total = (amount * commRate) / 100;
    if (!total || !mainAgentId) return null;
    return {
      total,
      shares: computeCommission(rule, {
        total,
        mainAgent: { id: mainAgentId, name: agentName(mainAgentId) },
        otherAgents: coAgentIds.filter((id) => id !== mainAgentId).map((id) => ({ id, name: agentName(id) })),
        dealer: dealerId ? { id: dealerId, name: dealerName(dealerId) } : null,
      }),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, commRate, mainAgentId, coAgentIds, dealerId, rule]);

  const canNext =
    (step === 0 && !!propertyId) ||
    (step === 1 && amount > 0) ||
    (step === 2 && !!mainAgentId) ||
    step === 3;

  const toggleCo = (id: string) =>
    setCoAgentIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <form action={action} className="space-y-6">
      {/* Stepper */}
      <ol className="flex items-center gap-2">
        {STEPS.map((label, i) => (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${
              i < step ? "bg-ink text-white" : i === step ? "border border-ink text-ink" : "border border-line text-muted"
            }`}>
              {i < step ? "✓" : i + 1}
            </span>
            <span className={`text-xs font-medium ${i === step ? "text-ink" : "text-muted"}`}>{label}</span>
            {i < STEPS.length - 1 && <span className="h-px flex-1 bg-line" />}
          </li>
        ))}
      </ol>

      {/* Step 1 — Deal */}
      <div className="surface p-6" hidden={step !== 0}>
        <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-ink">Deal</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="type">Type</label>
            <select id="type" name="type" className="field" value={type} onChange={(e) => setType(e.target.value as "SALE" | "RENTAL")}>
              <option value="SALE">Sale</option>
              <option value="RENTAL">Rental</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="propertyId">Property</label>
            <select id="propertyId" name="propertyId" className="field" value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
              <option value="" disabled>Select…</option>
              {properties.map((p) => <option key={p.id} value={p.id}>{p.reference} · {p.title}</option>)}
            </select>
            <Err state={state} name="propertyId" />
          </div>
          <div>
            <label className="label" htmlFor="clientId">Client</label>
            <select id="clientId" name="clientId" className="field" defaultValue="">
              <option value="">— None —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="dealerId">Dealer (optional)</label>
            <select id="dealerId" name="dealerId" className="field" value={dealerId} onChange={(e) => setDealerId(e.target.value)}>
              <option value="">— None —</option>
              {dealers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Step 2 — Money */}
      <div className="surface p-6" hidden={step !== 1}>
        <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-ink">Money</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="amount">{type === "SALE" ? "Sale price (PKR)" : "Monthly rent (PKR)"}</label>
            <input id="amount" name="amount" type="number" min="0" className="field" value={amount || ""} onChange={(e) => setAmount(Number(e.target.value))} />
            <Err state={state} name="amount" />
          </div>
          {type === "RENTAL" && (
            <>
              <div><label className="label" htmlFor="deposit">Deposit (PKR)</label><input id="deposit" name="deposit" type="number" min="0" className="field" /></div>
              <div><label className="label" htmlFor="leaseMonths">Lease (months)</label><input id="leaseMonths" name="leaseMonths" type="number" min="0" className="field" defaultValue="12" /></div>
            </>
          )}
        </div>
      </div>

      {/* Step 3 — Agents */}
      <div className="surface p-6" hidden={step !== 2}>
        <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-ink">Agents</h2>
        <p className="mb-4 text-xs text-muted">Pick the main agent; tick any co-agents who share the commission.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="mainAgentId">Main agent</label>
            <select id="mainAgentId" name="mainAgentId" className="field" value={mainAgentId} onChange={(e) => setMainAgentId(e.target.value)}>
              <option value="" disabled>Select…</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <Err state={state} name="mainAgentId" />
          </div>
          <fieldset>
            <legend className="label">Co-agents</legend>
            <div className="space-y-1">
              {agents.filter((a) => a.id !== mainAgentId).map((a) => (
                <label key={a.id} className="flex items-center gap-2 text-sm text-slate">
                  <input type="checkbox" name="coAgentIds" value={a.id} className="accent-ink" checked={coAgentIds.includes(a.id)} onChange={() => toggleCo(a.id)} />
                  {a.name}
                </label>
              ))}
              {agents.length <= 1 && <p className="text-xs text-muted">No other agents available.</p>}
            </div>
          </fieldset>
        </div>
      </div>

      {/* Step 4 — Review + commission preview */}
      <div className="surface p-6" hidden={step !== 3}>
        <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-ink">Review</h2>
        <dl className="mb-5 grid gap-x-8 sm:grid-cols-2">
          <div className="flex justify-between border-b border-line-soft py-2 text-sm"><dt className="text-muted">Type</dt><dd className="font-medium text-ink">{type === "SALE" ? "Sale" : "Rental"}</dd></div>
          <div className="flex justify-between border-b border-line-soft py-2 text-sm"><dt className="text-muted">Property</dt><dd className="font-medium text-ink">{properties.find((p) => p.id === propertyId)?.reference ?? "—"}</dd></div>
          <div className="flex justify-between border-b border-line-soft py-2 text-sm"><dt className="text-muted">{type === "SALE" ? "Price" : "Rent"}</dt><dd className="font-medium text-ink">{amount ? money(amount) : "—"}</dd></div>
          <div className="flex justify-between border-b border-line-soft py-2 text-sm"><dt className="text-muted">Main agent</dt><dd className="font-medium text-ink">{mainAgentId ? agentName(mainAgentId) : "—"}</dd></div>
        </dl>

        <div className="rounded-md border border-line bg-line-soft/50 p-4">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-ink">Estimated commission split</p>
              <p className="text-xs text-muted">Based on the company default rule. Final figure is set when the deal closes.</p>
            </div>
            <label className="text-xs text-muted">
              Est. rate
              <input type="number" min="0" step="0.5" value={commRate} onChange={(e) => setCommRate(Number(e.target.value))} className="field ml-2 inline-block w-20 py-1" />%
            </label>
          </div>
          {preview ? (
            <>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-muted">Estimated total</span>
                <span className="font-semibold text-ink">{money(preview.total)}</span>
              </div>
              <ul className="divide-y divide-line">
                {preview.shares.map((s, i) => (
                  <li key={i} className="flex items-center justify-between py-1.5 text-sm">
                    <span className="text-ink">{s.label} <span className="text-xs text-muted">· {s.pct}%</span></span>
                    <span className="font-medium text-ink">{compactMoney(s.amount)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-muted">Enter an amount and pick a main agent to preview the split.</p>
          )}
        </div>
      </div>

      {state.error && <p className="rounded-md border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger">{state.error}</p>}

      {/* Nav */}
      <div className="flex items-center justify-between">
        <div>
          {step > 0 && <button type="button" onClick={() => setStep((s) => s - 1)} className="btn-ghost">← Back</button>}
        </div>
        <div className="flex gap-2">
          <Link href="/deals" className="btn-ghost">Cancel</Link>
          {step < STEPS.length - 1 ? (
            <button type="button" disabled={!canNext} onClick={() => setStep((s) => s + 1)} className="btn-primary">Next →</button>
          ) : (
            <button type="submit" disabled={pending} className="btn-primary">{pending ? "Saving…" : "Create deal"}</button>
          )}
        </div>
      </div>
    </form>
  );
}
