interface SectionProps {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** A titled panel used to group dashboard widgets and list blocks. */
export function Section({ title, action, children, className = "" }: SectionProps) {
  return (
    <section className={`surface overflow-hidden ${className}`}>
      <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink">{title}</h2>
        {action}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}
