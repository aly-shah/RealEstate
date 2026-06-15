// Pure formatting helpers for the Sequences UI. Framework-agnostic (no server
// imports) so both the server pages and the client step form can use them.
import type { DripStepKind } from "@prisma/client";

/** Humanise a wait in hours: 2 → "2 hours", 24 → "1 day", 168 → "1 week", 26 → "1d 2h". */
export function humanizeHours(h: number): string {
  if (h <= 0) return "immediately";
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"}`;
  const days = Math.floor(h / 24);
  const rem = h % 24;
  if (rem === 0) {
    if (days % 7 === 0) {
      const w = days / 7;
      return `${w} week${w === 1 ? "" : "s"}`;
    }
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  return `${days}d ${rem}h`;
}

/** Cumulative offset from enrolment → a coarse "Day N" rail label. */
export function dayLabel(cumulativeHours: number): string {
  const d = Math.floor(cumulativeHours / 24);
  return d <= 0 ? "Day 0" : `Day ${d}`;
}

/** "in 3 min" / "in 5h" / "in 2 days" / "due now" for an upcoming send. */
export function relFromNow(date: Date): string {
  const ms = date.getTime() - Date.now();
  if (ms <= 0) return "due now";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `in ${mins} min`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `in ${hrs}h`;
  const days = Math.round(hrs / 24);
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

export const STEP_META: Record<DripStepKind, { label: string; verb: string }> = {
  WHATSAPP_TEMPLATE: { label: "WhatsApp", verb: "Send WhatsApp template" },
  TASK: { label: "Agent task", verb: "Create agent task" },
};
