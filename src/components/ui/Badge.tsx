import { humanize } from "@/lib/format";

type Tone = "neutral" | "ok" | "warn" | "danger" | "ink" | "gold" | "accent";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "border-line bg-line-soft text-slate",
  ok: "border-ok/25 bg-ok-bg text-ok",
  warn: "border-warn/25 bg-warn-bg text-warn",
  danger: "border-danger/25 bg-danger-bg text-danger",
  accent: "border-accent/25 bg-accent-wash text-accent",
  gold: "border-gold/30 bg-gold-wash text-[color:var(--color-gold)]",
  ink: "border-ink bg-ink text-white",
};

/**
 * Maps domain status enums to one of five quiet tones. Most in-progress states
 * read as neutral; only genuinely good/bad/terminal states get colour.
 */
export const STATUS_TONE: Record<string, Tone> = {
  // property
  AVAILABLE: "ok",
  RESERVED: "warn",
  UNDER_NEGOTIATION: "neutral",
  RENTED: "accent",
  SOLD: "gold",
  INACTIVE: "neutral",
  PENDING_VERIFICATION: "neutral",
  // leads
  NEW: "neutral",
  CONTACTED: "neutral",
  INTERESTED: "neutral",
  SITE_VISIT: "neutral",
  PROPERTY_SHOWN: "neutral",
  NEGOTIATION: "warn",
  TOKEN_BOOKING: "warn",
  PAYMENT: "warn",
  CLOSED_WON: "ok",
  CLOSED_LOST: "danger",
  // deals
  DRAFT: "neutral",
  TOKEN: "warn",
  BOOKED: "warn",
  AGREEMENT: "neutral",
  DONE: "ok",
  // payments
  PENDING: "warn",
  PARTIAL: "neutral",
  PAID: "ok",
  OVERDUE: "danger",
  // invoices
  ISSUED: "accent",
  CANCELLED: "neutral",
  // commission / verification
  PENDING_APPROVAL: "warn",
  APPROVED: "neutral",
  VERIFIED: "ok",
  REJECTED: "danger",
  FLAGGED: "warn",
  // generic + billing
  ACTIVE: "ok",
  SUSPENDED: "danger",
  TRIAL: "neutral",
  GRACE: "warn",
  PAST_DUE: "danger",
  // jobs
  QUEUED: "accent",
  RUNNING: "ink",
  FAILED: "danger",
};

interface BadgeProps {
  children: React.ReactNode;
  tone?: Tone;
}

export function Badge({ children, tone = "neutral" }: BadgeProps) {
  return <span className={`chip ${TONE_CLASS[tone]}`}>{children}</span>;
}

/** Status badge that auto-colours a known status enum value. */
export function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? "neutral";
  return (
    <Badge tone={tone}>
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          tone === "ok"
            ? "bg-ok"
            : tone === "warn"
              ? "bg-warn"
              : tone === "danger"
                ? "bg-danger"
                : tone === "accent"
                  ? "bg-accent"
                  : tone === "gold"
                    ? "bg-[color:var(--color-gold)]"
                    : tone === "ink"
                      ? "bg-white"
                      : "bg-muted"
        }`}
        aria-hidden
      />
      {humanize(status)}
    </Badge>
  );
}
