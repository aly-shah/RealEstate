import { prisma } from "@/lib/prisma";
import { runAi, type AiCallResult, type AiCallFailure } from "@/lib/ai/run";
import { fmtDate } from "@/lib/format";

/**
 * Conversation Intelligence — a thread-level brief of a lead.
 *
 * Unlike lead-next-action (which works off the lead's current STATE), this reads
 * the actual message HISTORY (the inbound WhatsApp trail in ActivityLog) plus
 * visit feedback, and asks the model to surface what an agent would otherwise
 * have to re-read the whole thread to find: a summary, sentiment, objections,
 * commitments, and the next best action.
 *
 * Output is a short Markdown brief. The cache hash includes the conversation
 * itself, so a new inbound message naturally invalidates a stale brief.
 */

const SYSTEM = `You are a real-estate sales conversation analyst for a Pakistani brokerage CRM (Proptimizr).

Given a lead's recent message history and context, produce a concise BRIEF an agent can read in 15 seconds.

Output format (Markdown, ≤150 words):
**Summary** — one sentence on where this lead stands.
**Sentiment** — warming / cooling / neutral, in 2-4 words, with a one-clause reason.
**Concerns** — bullet list of objections or hesitations (or "None surfaced").
**Commitments** — anything either side agreed to or promised (or "None").
**Next best action** — one concrete step for the next 24 hours.

Rules: use ONLY the provided history + context — never invent prices, areas, names, or commitments. Currency is PKR; areas are MARLA/KANAL/SQFT — don't convert. Direct tone, no preamble like "Based on the context".`;

export interface LeadBriefInput {
  companyId: string;
  leadId: string;
}

export async function generateLeadBrief(input: LeadBriefInput): Promise<AiCallResult | AiCallFailure> {
  const lead = await prisma.lead.findFirst({
    where: { id: input.leadId, companyId: input.companyId },
    include: {
      client: { select: { name: true } },
      agent: { select: { name: true } },
      showings: {
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { interestLevel: true, notes: true, clientFeedback: true },
      },
    },
  });
  if (!lead) return { ok: false, reason: "Lead not found." };

  // The actual conversation = the lead's inbound WhatsApp messages from the
  // activity trail (outbound isn't logged per-lead). Oldest→newest so the model
  // reads the thread in order.
  const messages = await prisma.activityLog.findMany({
    where: {
      companyId: input.companyId,
      entityType: "LEAD",
      entityId: input.leadId,
      action: "whatsapp.inbound",
    },
    orderBy: { createdAt: "asc" },
    take: 20,
    select: { createdAt: true, meta: true },
  });

  const thread = messages
    .map((m) => {
      const meta = (m.meta ?? {}) as Record<string, unknown>;
      const text = typeof meta.text === "string" ? meta.text : "";
      return text ? `[${fmtDate(m.createdAt)}] client: ${text.slice(0, 300)}` : "";
    })
    .filter(Boolean)
    .join("\n");

  const inputs: Record<string, unknown> = {
    stage: lead.stage,
    source: lead.source,
    client: lead.client?.name ?? "Unknown",
    agent: lead.agent?.name ?? "Unassigned",
    last_contacted: lead.lastContactedAt ? fmtDate(lead.lastContactedAt) : `never (created ${fmtDate(lead.createdAt)})`,
  };
  if (lead.prefArea) inputs.preferred_area = lead.prefArea;
  if (lead.prefType) inputs.preferred_type = lead.prefType;
  if (lead.budgetMax) inputs.budget_pkr_max = lead.budgetMax.toString();
  if (lead.budgetMin) inputs.budget_pkr_min = lead.budgetMin.toString();
  if (lead.requirements) inputs.requirements = lead.requirements.slice(0, 400);
  if (lead.showings.length > 0) {
    inputs.visit_feedback = lead.showings
      .map((s) => `${s.interestLevel ?? "?"}${s.clientFeedback ? `: ${s.clientFeedback.slice(0, 120)}` : s.notes ? `: ${s.notes.slice(0, 120)}` : ""}`)
      .join(" | ");
  }
  inputs.conversation = thread || "(no inbound messages on record)";

  return runAi({
    companyId: input.companyId,
    type: "LEAD_BRIEF",
    entity: { type: "LEAD", id: input.leadId },
    system: SYSTEM,
    prompt: "Produce the conversation brief for this lead.",
    inputs,
    maxTokens: 500,
    // Short TTL — a new inbound message changes the hash and invalidates anyway;
    // this just bounds re-reads of an unchanged thread.
    cacheTtlMs: 15 * 60_000,
  });
}
