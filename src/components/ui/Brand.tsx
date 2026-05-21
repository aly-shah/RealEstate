interface BrandProps {
  className?: string;
  variant?: "light" | "dark";
}

/** promptzer wordmark: a rounded blue tile with a spark, + lowercase wordmark. */
export function Brand({ className = "", variant = "light" }: BrandProps) {
  const text = variant === "dark" ? "text-white" : "text-ink";
  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-white shadow-[var(--shadow-card)]">
        <span className="text-base font-bold leading-none">p</span>
      </span>
      <span className={`text-lg font-semibold tracking-tight ${text}`}>
        promptzer
      </span>
    </span>
  );
}
