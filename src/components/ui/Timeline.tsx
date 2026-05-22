import { fmtDateTime } from "@/lib/format";

export interface TimelineEntry {
  id: string;
  summary: string;
  createdAt: Date | string;
  who?: string | null;
}

export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted">No activity recorded yet.</p>;
  }
  return (
    <ol className="relative space-y-4 border-l border-line pl-6">
      {entries.map((e) => (
        <li key={e.id} className="relative">
          <span
            className="absolute -left-[27px] top-1 grid h-4 w-4 place-items-center rounded-full border-2 border-paper shadow-[var(--shadow-card)]"
            style={{ backgroundImage: "var(--gradient-brand)" }}
            aria-hidden
          />
          <p className="text-sm text-ink">{e.summary}</p>
          <p className="mt-0.5 text-xs text-muted">
            {fmtDateTime(e.createdAt)}
            {e.who ? ` · ${e.who}` : ""}
          </p>
        </li>
      ))}
    </ol>
  );
}
