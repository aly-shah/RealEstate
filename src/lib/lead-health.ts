import type { LeadStage } from "@prisma/client";

export type LeadHealth = "FRESH" | "ATTENTION" | "STALE" | "URGENT";

export interface LeadHealthResult {
  health: LeadHealth;
  /** Why this lead earned its tag — short tags suitable for tooltip lines. */
  reasons: string[];
}

interface HealthInput {
  stage: LeadStage;
  /**
   * Authoritative "last meaningful contact" — set by recordShowing and by
   * marking a SHOWING/MEETING/FOLLOW_UP calendar event DONE. Falls back to
   * `createdAt` (passed in via the caller) when null so brand-new leads
   * aren't already stale.
   */
  lastContactedAt: Date | string | null;
  /** Fallback when lastContactedAt is null — lead's creation time. */
  createdAt: Date | string;
  /** Lead is unassigned? Treated as URGENT regardless of stage. */
  unassigned: boolean;
  /** Lead has any future scheduled event (any type)? Drives the "no follow-up" tag. */
  hasFutureEvent: boolean;
}

/**
 * Maximum days a lead may spend in each stage before it counts as stale.
 * Mirrors the auto-follow-up cadence + a margin: a CONTACTED lead is expected
 * to advance within ~3 days (48h follow-up + a day's slack); past 7 it's stale.
 */
const STALE_DAYS: Partial<Record<LeadStage, number>> = {
  NEW: 2,
  CONTACTED: 5,
  INTERESTED: 7,
  SITE_VISIT: 7,
  PROPERTY_SHOWN: 7,
  NEGOTIATION: 14,
  TOKEN_BOOKING: 14,
  PAYMENT: 21,
};

/** Earlier ATTENTION threshold so the UI can warn before a lead is fully stale. */
const ATTENTION_DAYS: Partial<Record<LeadStage, number>> = {
  NEW: 1,
  CONTACTED: 2,
  INTERESTED: 3,
  SITE_VISIT: 3,
  PROPERTY_SHOWN: 3,
  NEGOTIATION: 5,
  TOKEN_BOOKING: 7,
  PAYMENT: 10,
};

/**
 * Compute a lead-health tag from low-cost signals.
 *
 *   URGENT    — unassigned, OR way past stale window (1.5×)
 *   STALE     — past the per-stage stale window
 *   ATTENTION — past the per-stage attention threshold OR no future event scheduled
 *   FRESH     — everything fine
 *
 * Closed leads (CLOSED_WON / CLOSED_LOST) are always FRESH — they're done.
 */
export function leadHealth(input: HealthInput): LeadHealthResult {
  const reasons: string[] = [];

  if (input.stage === "CLOSED_WON" || input.stage === "CLOSED_LOST") {
    return { health: "FRESH", reasons: [] };
  }

  if (input.unassigned) {
    return { health: "URGENT", reasons: ["Unassigned"] };
  }

  // Prefer the explicit contact timestamp; fall back to creation time so a
  // never-contacted-but-just-created lead is correctly "fresh".
  const since = input.lastContactedAt ?? input.createdAt;
  const ageDays = (Date.now() - new Date(since).getTime()) / 86_400_000;
  const staleAfter = STALE_DAYS[input.stage] ?? 7;
  const attentionAfter = ATTENTION_DAYS[input.stage] ?? 3;

  let health: LeadHealth = "FRESH";

  if (ageDays >= staleAfter * 1.5) {
    health = "URGENT";
    reasons.push(`Quiet ${Math.round(ageDays)} days (way past ${staleAfter}d)`);
  } else if (ageDays >= staleAfter) {
    health = "STALE";
    reasons.push(`Quiet ${Math.round(ageDays)} days (>${staleAfter}d for stage)`);
  } else if (ageDays >= attentionAfter) {
    health = "ATTENTION";
    reasons.push(`Quiet ${Math.round(ageDays)} days`);
  }

  // The "no scheduled follow-up" flag bumps FRESH → ATTENTION but doesn't
  // override a worse health tag (a stale lead with a scheduled call is
  // still stale).
  if (!input.hasFutureEvent && health === "FRESH") {
    health = "ATTENTION";
    reasons.push("No follow-up scheduled");
  } else if (!input.hasFutureEvent && (health === "ATTENTION" || health === "STALE")) {
    reasons.push("No follow-up scheduled");
  }

  return { health, reasons };
}
