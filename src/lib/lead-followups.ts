import type { LeadStage } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Default follow-up cadence per stage, in hours. The values aim at the
 * shortest reasonable response window:
 *   - NEW: same-day or next-morning call (24h)
 *   - CONTACTED: ~2 working days to check progress (48h)
 *   - INTERESTED: long enough to send proposals / book a showing (72h)
 *
 * Other stages are agent-driven (showings, negotiation) and don't get an
 * auto-scheduled follow-up — the agent uses the calendar form directly.
 */
const STAGE_FOLLOWUP_HOURS: Partial<Record<LeadStage, number>> = {
  NEW: 24,
  CONTACTED: 48,
  INTERESTED: 72,
};

/**
 * Human label that lands in CalendarEvent.title — picked to be obvious at a
 * glance in the calendar grid so the agent doesn't have to drill in.
 */
function followUpTitle(clientName: string | null | undefined, stage: LeadStage): string {
  const base = clientName?.trim() || "Lead";
  switch (stage) {
    case "NEW":
      return `First contact — ${base}`;
    case "CONTACTED":
      return `Follow up — ${base}`;
    case "INTERESTED":
      return `Re-engage — ${base}`;
    default:
      return `Follow up — ${base}`;
  }
}

interface ScheduleInput {
  leadId: string;
  companyId: string;
  agentId: string | null;
  stage: LeadStage;
  /** Pass the lead's client name so the calendar event reads nicely. */
  clientName?: string | null;
}

/**
 * Create a FOLLOW_UP CalendarEvent for the lead's assigned agent — but only
 * if (a) the lead has an agent, (b) the stage has a configured cadence, and
 * (c) there isn't already a future FOLLOW_UP/SHOWING/MEETING scheduled.
 *
 * Returns the created event id when one was scheduled, or null when skipped.
 * Silent skips are intentional: this helper is fire-and-forget from the lead
 * actions and shouldn't surface errors for the "no cadence for this stage"
 * or "already has something planned" cases.
 */
export async function scheduleAutoFollowUp(input: ScheduleInput): Promise<string | null> {
  const { leadId, companyId, agentId, stage, clientName } = input;
  if (!agentId) return null;

  const hours = STAGE_FOLLOWUP_HOURS[stage];
  if (!hours) return null;

  // Dedup: if any forward-dated event covers this lead, don't pile another on.
  const now = new Date();
  const existing = await prisma.calendarEvent.findFirst({
    where: {
      companyId,
      leadId,
      startAt: { gt: now },
      status: "SCHEDULED",
      type: { in: ["FOLLOW_UP", "SHOWING", "MEETING"] },
    },
    select: { id: true },
  });
  if (existing) return null;

  const startAt = new Date(now.getTime() + hours * 60 * 60 * 1000);
  const event = await prisma.calendarEvent.create({
    data: {
      companyId,
      agentId,
      leadId,
      type: "FOLLOW_UP",
      status: "SCHEDULED",
      title: followUpTitle(clientName, stage),
      startAt,
    },
    select: { id: true },
  });
  return event.id;
}
