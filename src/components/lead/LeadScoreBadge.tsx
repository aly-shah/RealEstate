import type { LeadBand } from "@/lib/lead-score";

const STYLES: Record<LeadBand, { chip: string; label: string }> = {
  HOT:  { chip: "border-danger/30 bg-danger-bg text-danger", label: "Hot" },
  WARM: { chip: "border-warn/30 bg-warn-bg text-warn",       label: "Warm" },
  COLD: { chip: "border-line bg-line-soft text-slate",       label: "Cold" },
};

/**
 * Hot / Warm / Cold pill. When `overridden` is true, the chip carries a tiny
 * "•" marker so the office can see at a glance which scores were pinned by an
 * admin vs auto-computed.
 */
export function LeadScoreBadge({
  band,
  score,
  overridden,
  reasons,
}: {
  band: LeadBand;
  score?: number;
  overridden?: boolean;
  reasons?: string[];
}) {
  const s = STYLES[band];
  const title = reasons?.length ? reasons.join(" · ") : s.label;
  return (
    <span title={title} className={`chip ${s.chip}`}>
      {overridden && <span className="text-[10px]" aria-hidden>•</span>}
      {s.label}
      {score !== undefined && <span className="opacity-60">· {score}</span>}
    </span>
  );
}
