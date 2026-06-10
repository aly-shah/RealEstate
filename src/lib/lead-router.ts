import { prisma } from "@/lib/prisma";
import { notify, logActivity } from "@/lib/activity";
import { scheduleAutoFollowUp } from "@/lib/lead-followups";
import type { LeadStage } from "@prisma/client";

/**
 * Intelligent lead-routing engine.
 *
 * Turns an UNASSIGNED incoming lead into an assigned one (or broadcasts it),
 * using one of three strategies. It's deliberately self-contained and
 * fire-and-forget: routing is best-effort and must never block or fail lead
 * creation, so the whole body is wrapped in a try/catch that logs and swallows
 * (the lead simply stays unassigned for manual triage if anything goes wrong).
 *
 * Strategies:
 *   - TERRITORY_MATCH — assign to the agent who has actually closed business in
 *     the lead's preferred area (a proven specialist). Falls back to round-robin
 *     when the lead has no `prefArea` or no specialist exists.
 *   - ROUND_ROBIN — assign to the active agent who has waited longest since their
 *     last routed lead (NULL = never, sorts first), then stamp their cursor.
 *   - SHARK_TANK — leave the lead unassigned and alert every active agent that a
 *     lead is up for grabs (first to claim it wins).
 *
 * All assignment paths call the existing `notify()` framework with the
 * `LEAD_ASSIGNED` type and schedule the standard auto-follow-up, mirroring the
 * createLead flow.
 */

export type RoutingStrategy = "ROUND_ROBIN" | "TERRITORY_MATCH" | "SHARK_TANK";

export interface RouterConfig {
  /** Tenant the lead belongs to — asserted against the lead row for safety. */
  companyId: string;
  /** Which assignment algorithm to apply. */
  strategy: RoutingStrategy;
}

/** Minimal projection the router needs to make and announce a decision. */
interface RoutableLead {
  id: string;
  companyId: string;
  agentId: string | null;
  prefArea: string | null;
  stage: LeadStage;
  clientName: string | null;
}

/**
 * Route a single incoming lead. No-op (silently) when the lead is already
 * assigned, belongs to another tenant, or doesn't exist — so it's safe to call
 * unconditionally from createLead / the CSV import / a webhook handler.
 */
export async function routeIncomingLead(leadId: string, config: RouterConfig): Promise<void> {
  try {
    const lead = await loadRoutableLead(leadId);
    if (!lead) return;
    // Tenant safety: never let a mismatched config touch another company's lead.
    if (lead.companyId !== config.companyId) return;
    // Only route leads that nobody owns yet.
    if (lead.agentId) return;

    switch (config.strategy) {
      case "TERRITORY_MATCH": {
        const specialistId = await pickTerritorySpecialist(lead);
        if (specialistId) {
          await assignLeadToAgent(lead, specialistId, "territory");
          return;
        }
        // No specialist for this area (or no prefArea) — fall back to round-robin.
        await routeRoundRobin(lead);
        return;
      }
      case "ROUND_ROBIN": {
        await routeRoundRobin(lead);
        return;
      }
      case "SHARK_TANK": {
        await broadcastSharkTank(lead);
        return;
      }
    }
  } catch (err) {
    // Best-effort: routing failure must not propagate into lead creation. Log
    // and leave the lead unassigned for manual triage from the leads list.
    console.error(`[lead-router] failed to route lead ${leadId}:`, err);
  }
}

/** Fetch the routing projection for a lead, flattening the client name. */
async function loadRoutableLead(leadId: string): Promise<RoutableLead | null> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      companyId: true,
      agentId: true,
      prefArea: true,
      stage: true,
      client: { select: { name: true } },
    },
  });
  if (!lead) return null;
  return {
    id: lead.id,
    companyId: lead.companyId,
    agentId: lead.agentId,
    prefArea: lead.prefArea,
    stage: lead.stage,
    clientName: lead.client?.name ?? null,
  };
}

/**
 * TERRITORY_MATCH core: the active agent who, as the MAIN or co-agent on a
 * CLOSED_WON deal, has closed the most business on properties whose `area`
 * matches the lead's `prefArea`. Returns null when the lead has no preferred
 * area or no agent has a closed deal there.
 */
async function pickTerritorySpecialist(lead: RoutableLead): Promise<string | null> {
  const area = lead.prefArea?.trim();
  if (!area) return null;

  // Group the tenant's CLOSED_WON deal-agent links by agent, restricted to
  // deals on a property in the matching area, and take the busiest closer.
  const ranked = await prisma.dealAgent.groupBy({
    by: ["agentId"],
    where: {
      agent: { companyId: lead.companyId, role: "AGENT", status: "ACTIVE" },
      deal: {
        companyId: lead.companyId,
        status: "CLOSED_WON",
        property: { area: { contains: area, mode: "insensitive" } },
      },
    },
    _count: { agentId: true },
    orderBy: { _count: { agentId: "desc" } },
    take: 1,
  });

  return ranked[0]?.agentId ?? null;
}

/**
 * ROUND_ROBIN core: pick the active agent who has waited longest (oldest or NULL
 * `lastLeadAssignedAt`), stamp their cursor to now(), and assign. No-op when the
 * tenant has no active agents.
 */
async function routeRoundRobin(lead: RoutableLead): Promise<void> {
  const agent = await prisma.user.findFirst({
    where: { companyId: lead.companyId, role: "AGENT", status: "ACTIVE" },
    // NULL (never assigned) sorts first, then the oldest timestamp.
    orderBy: [{ lastLeadAssignedAt: { sort: "asc", nulls: "first" } }],
    select: { id: true },
  });
  if (!agent) {
    console.warn(`[lead-router] no active agent to round-robin lead ${lead.id}`);
    return;
  }

  // Advance the cursor BEFORE assigning so a concurrent route can't pick the
  // same agent twice in a tight window.
  await prisma.user.update({
    where: { id: agent.id },
    data: { lastLeadAssignedAt: new Date() },
  });

  await assignLeadToAgent(lead, agent.id, "round-robin");
}

/**
 * SHARK_TANK core: keep the lead unassigned and alert every active agent that a
 * lead is available to claim. Uses GENERAL (there's no dedicated enum value);
 * the title makes the intent unambiguous.
 */
async function broadcastSharkTank(lead: RoutableLead): Promise<void> {
  const agents = await prisma.user.findMany({
    where: { companyId: lead.companyId, role: "AGENT", status: "ACTIVE" },
    select: { id: true },
  });
  if (agents.length === 0) return;

  const who = lead.clientName ?? "a new enquiry";
  await Promise.all(
    agents.map((a) =>
      notify({
        companyId: lead.companyId,
        userId: a.id,
        type: "GENERAL",
        title: `Lead up for grabs — ${who}`,
        body: "Unassigned lead available. First to claim it wins.",
        link: `/leads/${lead.id}`,
      }),
    ),
  );

  await logActivity({
    companyId: lead.companyId,
    action: "lead.routed",
    entityType: "LEAD",
    entityId: lead.id,
    summary: `Shark-tank: lead broadcast to ${agents.length} agent${agents.length === 1 ? "" : "s"}`,
    meta: { strategy: "SHARK_TANK", agents: agents.length },
  });
}

/**
 * Shared assignment tail: set the owning agent, notify them (LEAD_ASSIGNED),
 * log the routing decision, and schedule the standard stage-based follow-up.
 */
async function assignLeadToAgent(
  lead: RoutableLead,
  agentId: string,
  via: "territory" | "round-robin",
): Promise<void> {
  await prisma.lead.update({ where: { id: lead.id }, data: { agentId } });

  await notify({
    companyId: lead.companyId,
    userId: agentId,
    type: "LEAD_ASSIGNED",
    title: `New lead assigned — ${lead.clientName ?? "Unnamed"}`,
    link: `/leads/${lead.id}`,
  });

  await logActivity({
    companyId: lead.companyId,
    action: "lead.routed",
    entityType: "LEAD",
    entityId: lead.id,
    summary: `Auto-assigned lead via ${via}`,
    meta: { strategy: via === "territory" ? "TERRITORY_MATCH" : "ROUND_ROBIN", agentId },
  });

  // Mirror createLead: give the new owner a follow-up task for the stage.
  await scheduleAutoFollowUp({
    leadId: lead.id,
    companyId: lead.companyId,
    agentId,
    stage: lead.stage,
    clientName: lead.clientName,
  });
}
