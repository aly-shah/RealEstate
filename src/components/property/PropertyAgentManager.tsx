import {
  assignPropertyAgent,
  unassignPropertyAgent,
} from "@/app/(app)/properties/actions";

interface AgentOption {
  id: string;
  name: string;
}

interface PropertyAgentManagerProps {
  propertyId: string;
  assigned: AgentOption[];
  available: AgentOption[];
}

/**
 * OWNER/ADMIN-only editor for property↔agent links. Renders the current
 * agents with remove (✕) buttons and a "+ Add" picker filtered to agents
 * not already assigned. Both actions are plain form posts so the page
 * revalidates without client JavaScript.
 */
export function PropertyAgentManager({
  propertyId,
  assigned,
  available,
}: PropertyAgentManagerProps) {
  const assignedIds = new Set(assigned.map((a) => a.id));
  const selectable = available.filter((a) => !assignedIds.has(a.id));

  return (
    <div className="space-y-2">
      {assigned.length === 0 ? (
        <p className="text-sm text-muted">No agents assigned.</p>
      ) : (
        <ul className="space-y-1">
          {assigned.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between rounded-lg border border-line bg-paper px-2.5 py-1.5"
            >
              <span className="text-sm text-ink">{a.name}</span>
              <form action={unassignPropertyAgent}>
                <input type="hidden" name="propertyId" value={propertyId} />
                <input type="hidden" name="agentId" value={a.id} />
                <button
                  type="submit"
                  className="text-xs text-muted transition hover:text-danger"
                  aria-label={`Remove ${a.name}`}
                  title="Remove"
                >
                  ✕
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      {selectable.length > 0 ? (
        <form
          action={assignPropertyAgent}
          className="flex items-center gap-2 border-t border-line-soft pt-2"
        >
          <input type="hidden" name="propertyId" value={propertyId} />
          <select
            name="agentId"
            defaultValue=""
            required
            className="field flex-1 py-1.5 text-xs"
            aria-label="Pick an agent to add"
          >
            <option value="" disabled>
              Add agent…
            </option>
            {selectable.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <button type="submit" className="btn-ghost px-3 py-1.5 text-xs">
            + Add
          </button>
        </form>
      ) : (
        assigned.length > 0 && (
          <p className="border-t border-line-soft pt-2 text-xs text-muted">
            All agents in this company are assigned.
          </p>
        )
      )}
    </div>
  );
}
