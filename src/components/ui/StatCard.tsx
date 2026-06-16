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
    <div className="surface group relative overflow-hidden p-5 transition duration-200 hover:-translate-y-1 hover:shadow-[var(--shadow-pop)]">
      {/* Always-on gradient/tone accent rail along the top. */}
      <span className={`absolute inset-x-0 top-0 h-1 ${MARKER[tone]}`} aria-hidden />
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${MARKER[tone]}`} />
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">{label}</p>
        </div>
        {icon && (
          <span className={`grid h-9 w-9 place-items-center rounded-xl text-base ring-1 ring-inset ring-black/[0.04] transition group-hover:scale-105 ${ICON_TINT[tone]}`}>
            {icon}
          </span>
        )}
      </div>
      <p className="mt-3.5 text-[1.9rem] font-bold leading-none tracking-[-0.02em] text-ink">
        {value}
      </p>
      {sub && <p className="mt-2 text-xs text-slate">{sub}</p>}
    </div>
  );
}
