import { prisma } from "@/lib/prisma";
import { runAi, type AiCallResult, type AiCallFailure } from "@/lib/ai/run";
import { fmtDate } from "@/lib/format";

/**
 * Suggest the single next action an agent should take for a lead.
 *
 * Inputs are everything the agent would see on the lead detail page
 * compressed into a structured context block — stage, last contact
 * time, recent activity, pref summary. The system prompt is frozen
 * (cache-friendly) and just tells Claude what kind of output we want.
 *
 * Output is a short Markdown blob: one recommended action + 1-2
 * supporting points. Capped at ~150 tokens of output via the prompt.
 */

const SYSTEM = `You are a senior real-estate sales coach assisting Pakistani brokerage agents on a CRM called Proptimizr.

Given a lead's current state, suggest ONE concrete next action the agent should take in the next 24 hours.

Output format (Markdown, ≤120 words total):
- Open with a single short heading describing the recommended action.
- Then 1-2 bullet points explaining why and how to do it.
- Reference the lead's stage, budget, area, or recency by name.
- Use a direct, action-first tone — no preamble like "Based on the context".
- Never invent facts not present in the context block; if the data is thin, say so and recommend the obvious next step (contact, qualify, schedule a visit).
- Currency is PKR; areas are MARLA/KANAL/SQFT. Don't convert.`;

export interface LeadNextActionInput {
  companyId: string;
  leadId: string;
}

export async function suggestLeadNextAction(
  input: LeadNextActionInput,
): Promise<AiCallResult | AiCallFailure> {
  const lead = await prisma.lead.findFirst({
    where: { id: input.leadId, companyId: input.companyId },
    include: {
      client: { select: { name: true, phone: true } },
      agent: { select: { name: true } },
      property: { select: { title: true, reference: true, area: true, city: true } },
      events: {
        orderBy: { startAt: "desc" },
        take: 5,
        select: { type: true, status: true, startAt: true, title: true },
      },
      showings: {
        orderBy: { createdAt: "desc" },
        take: 3,
        select: { interestLevel: true, notes: true },
      },
    },
  });
  if (!lead) return { ok: false, reason: "Lead not found." };

  // Build a compact context block. Only include fields with values so the
  // hash + cache footprint stay tight.
  const inputs: Record<string, unknown> = {
    stage: lead.stage,
    source: lead.source,
    agent: lead.agent?.name ?? "Unassigned",
    client: lead.client?.name ?? "Unknown",
    last_contacted: lead.lastContactedAt
      ? fmtDate(lead.lastContactedAt)
      : `never (created ${fmtDate(lead.createdAt)})`,
  };
  if (lead.prefArea) inputs.preferred_area = lead.prefArea;
  if (lead.prefType) inputs.preferred_type = lead.prefType;
  if (lead.budgetMax) inputs.budget_pkr_max = lead.budgetMax.toString();
  if (lead.budgetMin) inputs.budget_pkr_min = lead.budgetMin.toString();
  if (lead.requirements) inputs.notes = lead.requirements.slice(0, 400);
  if (lead.property) inputs.linked_property = `${lead.property.reference} — ${lead.property.title}`;
  if (lead.events.length > 0) {
    inputs.recent_events = lead.events
      .map((e) => `${e.type}/${e.status} ${fmtDate(e.startAt)}: ${e.title}`)
      .join(" | ");
  }
  if (lead.showings.length > 0) {
    inputs.recent_visits = lead.showings
      .map((s) => `${s.interestLevel ?? "?"}${s.notes ? `: ${s.notes.slice(0, 80)}` : ""}`)
      .join(" | ");
  }

  return runAi({
    companyId: input.companyId,
    type: "LEAD_NEXT_ACTION",
    entity: { type: "LEAD", id: input.leadId },
    system: SYSTEM,
    prompt: "Suggest the single best next action for this lead, with brief reasoning.",
    inputs,
    maxTokens: 400,
  });
}
