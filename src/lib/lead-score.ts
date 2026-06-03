import type { LeadStage, LeadSource, InterestLevel, LeadScoreOverride } from "@prisma/client";

export type LeadBand = "HOT" | "WARM" | "COLD";

export interface LeadScoreResult {
  score: number;          // 0-100, clamped
  band: LeadBand;
  /** Short bullets the UI can show as "why this score" tooltips. */
  reasons: string[];
  /** True when an admin override was applied (band reflects the override). */
  overridden: boolean;
}

interface ScoreInput {
  stage: LeadStage;
  source: LeadSource;
  /** Set when the lead has any budget — the rough quality signal. */
  hasBudget: boolean;
  /** Linked to a specific property already? Strong intent signal. */
  hasProperty: boolean;
  /** updatedAt for "is this recent activity?" — fed by the caller. */
  updatedAt: Date | string;
  /** Highest InterestLevel across the lead's showings. */
  topInterest?: InterestLevel | null;
  /** Has the lead been shown any property yet? */
  hasShowing: boolean;
  /** Admin override; when set we still compute the raw score but the BAND is forced. */
  override?: LeadScoreOverride | null;
}

/**
 * Stage carries the heaviest weight — a lead in NEGOTIATION is implicitly
 * higher-intent than a fresh enquiry no matter what the surrounding signals
 * say. CLOSED_LOST/CLOSED_WON terminate the funnel.
 */
const STAGE_POINTS: Record<LeadStage, number> = {
  NEW: 10,
  CONTACTED: 20,
  INTERESTED: 35,
  SITE_VISIT: 45,
  PROPERTY_SHOWN: 55,
  NEGOTIATION: 75,
  TOKEN_BOOKING: 85,
  PAYMENT: 92,
  CLOSED_WON: 100,
  CLOSED_LOST: 0,
};

/** REFERRAL / REPEAT_CLIENT convert best; portals and socials are noisier. */
const SOURCE_POINTS: Partial<Record<LeadSource, number>> = {
  REFERRAL: 12,
  REPEAT_CLIENT: 12,
  WALK_IN: 8,
  CALL: 6,
  PORTAL: 4,
  SOCIAL_MEDIA: 4,
  OTHER: 0,
};

const INTEREST_POINTS: Partial<Record<InterestLevel, number>> = {
  HIGH: 18,
  MEDIUM: 8,
  LOW: 2,
  NONE: -6,
};

function bandFor(score: number): LeadBand {
  if (score >= 70) return "HOT";
  if (score >= 40) return "WARM";
  return "COLD";
}

/**
 * Compute a hot/warm/cold score for a lead from low-cost signals (no joins
 * beyond what the lead-list query already pulls).
 *
 * Override semantics: when an admin pins a band, we still expose the raw
 * computed score so the UI can show "auto: 62 → admin: HOT" if it wants —
 * but the returned `band` reflects the override.
 */
export function scoreLead(input: ScoreInput): LeadScoreResult {
  const reasons: string[] = [];
  let score = 0;

  // Stage signal (the dominant factor).
  const stagePts = STAGE_POINTS[input.stage] ?? 0;
  score += stagePts;
  if (stagePts > 0) reasons.push(`Stage: ${input.stage.replace(/_/g, " ").toLowerCase()} (+${stagePts})`);

  // Source quality.
  const srcPts = SOURCE_POINTS[input.source] ?? 0;
  if (srcPts > 0) {
    score += srcPts;
    reasons.push(`Source: ${input.source.toLowerCase()} (+${srcPts})`);
  }

  // Profile completeness.
  if (input.hasBudget) {
    score += 6;
    reasons.push("Budget captured (+6)");
  }
  if (input.hasProperty) {
    score += 8;
    reasons.push("Linked to a property (+8)");
  }

  // Recency: bumped when the lead saw activity in the last 7 days; penalised
  // mildly when it's been quiet for >14 days (a separate concern from health,
  // but a useful signal for ranking).
  const ageDays = (Date.now() - new Date(input.updatedAt).getTime()) / 86_400_000;
  if (ageDays <= 7) {
    score += 8;
    reasons.push("Recent activity (+8)");
  } else if (ageDays > 14) {
    score -= 6;
    reasons.push(`Quiet ${Math.round(ageDays)} days (−6)`);
  }

  // Showing signal: a showing happened + how the client reacted.
  if (input.hasShowing) {
    score += 4;
    reasons.push("Has been shown a property (+4)");
  }
  if (input.topInterest) {
    const pts = INTEREST_POINTS[input.topInterest] ?? 0;
    if (pts !== 0) {
      score += pts;
      reasons.push(`Interest ${input.topInterest.toLowerCase()} (${pts > 0 ? "+" : ""}${pts})`);
    }
  }

  // Clamp before band computation.
  score = Math.max(0, Math.min(100, Math.round(score)));

  if (input.override) {
    return {
      score,
      band: input.override === "HOT" ? "HOT" : input.override === "WARM" ? "WARM" : "COLD",
      reasons,
      overridden: true,
    };
  }
  return { score, band: bandFor(score), reasons, overridden: false };
}
