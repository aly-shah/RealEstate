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
  ink: "bg-ink",
  accent: "bg-accent brand-gradient",
  gold: "bg-[color:var(--color-gold)]",
  ok: "bg-ok",
  danger: "bg-danger",
};

const ICON_TINT: Record<NonNullable<StatCardProps["tone"]>, string> = {
  default: "bg-subtle text-slate",
  ink: "bg-ink/5 text-ink",
  accent: "bg-accent-wash text-accent",
  gold: "bg-gold-wash text-[color:var(--color-gold)]",
  ok: "bg-ok-bg text-ok",
  danger: "bg-danger-bg text-danger",
};

export function StatCard({ label, value, sub, tone = "default", icon }: StatCardProps) {
  return (
    <div className="surface group relative overflow-hidden p-5 transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)]">
      <span
        className={`absolute inset-x-0 top-0 h-[3px] origin-left scale-x-0 transition-transform duration-500 group-hover:scale-x-100 ${MARKER[tone]}`}
        aria-hidden
      />
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${MARKER[tone]}`} />
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</p>
        </div>
        {icon && (
          <span className={`grid h-8 w-8 place-items-center rounded-lg text-base ${ICON_TINT[tone]}`}>
            {icon}
          </span>
        )}
      </div>
      <p className="mt-3 text-[1.65rem] font-semibold leading-none tracking-tight text-ink">
        {value}
      </p>
      {sub && <p className="mt-2 text-xs text-slate">{sub}</p>}
    </div>
  );
}
