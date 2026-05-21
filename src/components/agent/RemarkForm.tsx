"use client";

import { useActionState } from "react";
import { updateAgentRemark, type FormState } from "@/app/(app)/agents/actions";

export function RemarkForm({ agentId, initial }: { agentId: string; initial: string | null }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateAgentRemark, {});

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="agentId" value={agentId} />
      <textarea
        name="remark"
        rows={4}
        defaultValue={initial ?? ""}
        placeholder="Private notes about this agent (coaching points, strengths, concerns)…"
        className="field resize-none"
      />
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="btn-ghost px-3 py-1.5 text-xs">
          {pending ? "Saving…" : "Save remark"}
        </button>
        {state.ok && <span className="text-xs text-ok">Saved.</span>}
        {state.error && <span className="text-xs text-danger">{state.error}</span>}
      </div>
    </form>
  );
}
