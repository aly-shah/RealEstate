import type { DealStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Deal close-probability model.
 *
 * Each open deal stage carries a base probability of eventually closing-won.
 * Those defaults are then *calibrated* to the company's own history: a firm that
 * historically closes most of its decided deals gets its curve scaled up, one
 * that loses most gets it scaled down — so "% likely to close" reflects reality,
 * not a hand-picked constant. Below a minimum sample we keep the defaults rather
 * than trust a noisy rate.
 *
 * This is the single source of truth for the weighted pipeline forecast
 * (lib/reports.ts) and the per-deal likelihood shown on the deal page.
 */

/** Base win probability per stage, before per-company calibration. */
export const BASE_STAGE_WIN: Record<DealStatus, number> = {
  DRAFT: 0.1,
  NEGOTIATION: 0.3,
  TOKEN: 0.6,
  BOOKED: 0.8,
  AGREEMENT: 0.9,
  CLOSED_WON: 1,
  CLOSED_LOST: 0,
};

/** Decided (won+lost) deals required before a company's own rate is trusted. */
export const MIN_CALIBRATION_SAMPLE = 10;

// The base curve assumes a decided deal is roughly a coin-flip on average;
// calibration nudges it toward the company's real rate. Clamp the multiplier so
// a lucky/unlucky small sample can't wildly distort the forecast.
const REFERENCE_DECISION_RATE = 0.5;
const FACTOR_MIN = 0.5;
const FACTOR_MAX = 1.5;
// Cap open stages just under 1 so nothing in-flight ever reads as a certainty.
const OPEN_CAP = 0.98;

export interface WinRateCalibration {
  won: number;
  lost: number;
  /** Historical win rate won/(won+lost), or null when no decided deals yet. */
  rate: number | null;
  /** Multiplier applied to the base stage weights (1 when uncalibrated). */
  factor: number;
  /** True when the decided-deal sample was large enough to calibrate. */
  calibrated: boolean;
}

/** Company's historical close rate → a calibration factor for the stage curve. */
export async function winRateCalibration(companyId: string): Promise<WinRateCalibration> {
  const [won, lost] = await Promise.all([
    prisma.deal.count({ where: { companyId, status: "CLOSED_WON" } }),
    prisma.deal.count({ where: { companyId, status: "CLOSED_LOST" } }),
  ]);
  const decided = won + lost;
  if (decided < MIN_CALIBRATION_SAMPLE) {
    return { won, lost, rate: decided ? won / decided : null, factor: 1, calibrated: false };
  }
  const rate = won / decided;
  const factor = Math.min(FACTOR_MAX, Math.max(FACTOR_MIN, rate / REFERENCE_DECISION_RATE));
  return { won, lost, rate, factor, calibrated: true };
}

/** Calibrated win weight (0–1) for a stage, given a calibration factor. */
export function stageWinWeight(status: DealStatus, factor = 1): number {
  if (status === "CLOSED_WON") return 1;
  if (status === "CLOSED_LOST") return 0;
  return Math.min(OPEN_CAP, Math.max(0, (BASE_STAGE_WIN[status] ?? 0) * factor));
}

/** Per-deal close likelihood as a 0–100 integer. */
export function closeProbability(status: DealStatus, factor = 1): number {
  if (status === "CLOSED_WON") return 100;
  if (status === "CLOSED_LOST") return 0;
  return Math.round(stageWinWeight(status, factor) * 100);
}
