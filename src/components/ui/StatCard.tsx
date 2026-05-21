interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  /** Tints the small accent marker; cards stay white for a clean enterprise look. */
  tone?: "default" | "ink" | "accent" | "gold" | "ok" | "danger";
  icon?: React.ReactNode;
}

const MARKER: Record<NonNullable<StatCardProps["tone"]>, string> = {
  default: "bg-line",
  ink: "bg-accent",
  accent: "bg-accent",
  gold: "bg-gold",
  ok: "bg-ok",
  danger: "bg-danger",
};

export function StatCard({ label, value, sub, tone = "default", icon }: StatCardProps) {
  return (
    <div className="surface p-5 transition hover:shadow-[var(--shadow-pop)]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${MARKER[tone]}`} />
          <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
        </div>
        {icon && <span className="text-base text-muted">{icon}</span>}
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-ink">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate">{sub}</p>}
    </div>
  );
}
