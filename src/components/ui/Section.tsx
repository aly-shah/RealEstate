interface SectionProps {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** A titled panel used to group dashboard widgets and list blocks. */
export function Section({ title, action, children, className = "" }: SectionProps) {
  return (
    <section className={`surface-soft overflow-hidden ${className}`}>
      <header className="flex items-center justify-between border-b border-line bg-gradient-to-b from-paper to-canvas/40 px-5 py-3.5">
        <h2 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate">
          <span className="h-3.5 w-1 rounded-full brand-gradient" aria-hidden />
          {title}
        </h2>
        {action}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}
