interface EmptyStateProps {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}

export function EmptyState({ title, hint, action }: EmptyStateProps) {
  return (
    <div className="surface flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-md border border-line bg-line-soft text-muted">
        ◇
      </div>
      <p className="text-base font-medium text-ink">{title}</p>
      {hint && <p className="max-w-sm text-sm text-muted">{hint}</p>}
      {action}
    </div>
  );
}
