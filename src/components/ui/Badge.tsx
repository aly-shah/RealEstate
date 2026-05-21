import { humanize } from "@/lib/format";

type Tone = "neutral" | "ok" | "warn" | "danger" | "ink" | "gold" | "accent";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "border-line bg-line-soft text-slate",
  ok: "border-ok/30 bg-ok-bg text-ok",
  warn: "border-warn/30 bg-warn-bg text-warn",
  danger: "border-danger/30 bg-danger-bg text-danger",
  accent: "border-accent/25 bg-accent-wash text-accent",
  gold: "border-gold/35 bg-gold-wash text-[color:var(--color-gold)]",
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
  // commission / verification
  PENDING_APPROVAL: "warn",
  APPROVED: "neutral",
  VERIFIED: "ok",
  REJECTED: "danger",
  FLAGGED: "warn",
  // generic
  ACTIVE: "ok",
  SUSPENDED: "danger",
  TRIAL: "neutral",
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
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{humanize(status)}</Badge>;
}
