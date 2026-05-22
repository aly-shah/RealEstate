interface EmptyStateProps {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}

export function EmptyState({ title, hint, action }: EmptyStateProps) {
  return (
    <div className="surface flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div
        className="grid h-12 w-12 place-items-center rounded-2xl border border-line bg-accent-wash/60 text-accent"
        aria-hidden
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 7h16M4 12h10M4 17h7" />
        </svg>
      </div>
      <p className="text-base font-semibold text-ink">{title}</p>
      {hint && <p className="max-w-sm text-sm text-muted">{hint}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
