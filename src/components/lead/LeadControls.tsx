"use client";

import { useState } from "react";
import { humanize } from "@/lib/format";
import { advanceStage, assignAgent } from "@/app/(app)/leads/actions";

const STAGES = ["NEW", "CONTACTED", "INTERESTED", "SITE_VISIT", "PROPERTY_SHOWN", "NEGOTIATION", "TOKEN_BOOKING", "PAYMENT", "CLOSED_WON", "CLOSED_LOST"];

export function StageControl({ id, current }: { id: string; current: string }) {
  const [stage, setStage] = useState(current);
  const isLost = stage === "CLOSED_LOST";

  return (
    <form action={advanceStage} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <div>
        <label className="label" htmlFor="stage">Pipeline stage</label>
        <select id="stage" name="stage" value={stage} onChange={(e) => setStage(e.target.value)} className="field">
          {STAGES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
        </select>
      </div>
      {isLost && (
        <div>
          <label className="label" htmlFor="lostReason">Reason for loss</label>
          <input id="lostReason" name="lostReason" className="field" placeholder="Why was this lead lost?" />
        </div>
      )}
      <button type="submit" className="btn-primary w-full">Update stage</button>
    </form>
  );
}

interface AssignControlProps {
  id: string;
  currentAgentId: string | null;
  agents: { id: string; name: string }[];
}

export function AssignControl({ id, currentAgentId, agents }: AssignControlProps) {
  return (
    <form action={assignAgent} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <select name="agentId" defaultValue={currentAgentId ?? ""} className="field">
        <option value="">— Unassigned —</option>
        {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <button type="submit" className="btn-ghost px-3 py-2 text-xs">Assign</button>
    </form>
  );
}
