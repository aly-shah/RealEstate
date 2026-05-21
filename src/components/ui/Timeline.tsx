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
    <ol className="relative ml-1 space-y-4 border-l border-line pl-5">
      {entries.map((e) => (
        <li key={e.id} className="relative">
          <span className="absolute -left-[23px] top-1.5 h-2 w-2 rounded-full border border-line bg-canvas" />
          <p className="text-sm text-ink">{e.summary}</p>
          <p className="text-xs text-muted">
            {fmtDateTime(e.createdAt)}
            {e.who ? ` · ${e.who}` : ""}
          </p>
        </li>
      ))}
    </ol>
  );
}
