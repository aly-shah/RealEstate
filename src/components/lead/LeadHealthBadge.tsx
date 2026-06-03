import type { LeadHealth } from "@/lib/lead-health";

const STYLES: Record<LeadHealth, { dot: string; text: string; label: string }> = {
  FRESH:     { dot: "bg-ok",     text: "text-ok",     label: "Fresh" },
  ATTENTION: { dot: "bg-warn",   text: "text-warn",   label: "Attention" },
  STALE:     { dot: "bg-warn",   text: "text-warn",   label: "Stale" },
  URGENT:    { dot: "bg-danger", text: "text-danger", label: "Urgent" },
};

/**
 * Compact pill (dot + word) for lead health. Designed to drop into a table
 * cell without taking much horizontal room. Tooltip carries the `reasons`.
 */
export function LeadHealthBadge({
  health,
  reasons,
  size = "sm",
}: {
  health: LeadHealth;
  reasons?: string[];
  size?: "sm" | "md";
}) {
  const s = STYLES[health];
  const title = reasons?.length ? reasons.join(" · ") : s.label;
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 text-xs ${s.text} ${size === "md" ? "" : "leading-none"}`}
    >
      <span className={`h-2 w-2 rounded-full ${s.dot}`} aria-hidden />
      {s.label}
    </span>
  );
}
