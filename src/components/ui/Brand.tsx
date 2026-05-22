interface BrandProps {
  className?: string;
  variant?: "light" | "dark";
  size?: "sm" | "md" | "lg";
}

/**
 * promptzer mark: a soft-cornered gradient tile with a stylized roof + door,
 * paired with a tight modern wordmark.
 */
export function Brand({ className = "", variant = "light", size = "md" }: BrandProps) {
  const text = variant === "dark" ? "text-white" : "text-ink";
  const dim = size === "lg" ? "h-10 w-10" : size === "sm" ? "h-7 w-7" : "h-9 w-9";
  const word = size === "lg" ? "text-xl" : size === "sm" ? "text-base" : "text-lg";

  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <span
        className={`relative grid ${dim} place-items-center overflow-hidden rounded-xl bg-accent text-white shadow-[var(--shadow-soft)]`}
        style={{ backgroundImage: "var(--gradient-brand)" }}
        aria-hidden
      >
        {/* subtle highlight */}
        <span className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-white/15" />
        <svg viewBox="0 0 24 24" className="h-[58%] w-[58%]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 11.2 12 4l9 7.2" />
          <path d="M5.5 10v9.5h13V10" />
          <path d="M10 19.5V14h4v5.5" />
        </svg>
      </span>
      <span className={`${word} font-semibold tracking-tight ${text}`}>
        promptzer
      </span>
    </span>
  );
}
