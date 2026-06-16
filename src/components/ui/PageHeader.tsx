interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export function PageHeader({ eyebrow, title, subtitle, action }: PageHeaderProps) {
  return (
    <div className="pz-fade-up mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && (
          <p className="mb-2 inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-accent">
            <span className="inline-block h-1.5 w-1.5 rounded-full brand-gradient" />
            {eyebrow}
          </p>
        )}
        <h1 className="text-[2rem] font-bold leading-[1.1] tracking-[-0.02em] text-ink sm:text-[2.4rem]">
          {title}
        </h1>
        {subtitle && <p className="mt-2 max-w-2xl text-sm text-slate">{subtitle}</p>}
      </div>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </div>
  );
}
