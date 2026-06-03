import { prisma } from "@/lib/prisma";
import { runAi, type AiCallResult, type AiCallFailure } from "@/lib/ai/run";

/**
 * Draft a WhatsApp reply tailored to a lead's current state.
 *
 * Output is a single message ready to paste into WhatsApp (or hand to
 * the wa.me launcher). Tone matches Pakistani real-estate WhatsApp
 * norms — friendly but professional, English-first with the option to
 * sprinkle a polite Urdu greeting. Plain text, no Markdown, no
 * headings — it'll be sent verbatim.
 */

const SYSTEM = `You draft outbound WhatsApp messages for Pakistani real-estate agents on a CRM called Proptimizr.

Output requirements:
- Plain text only — no Markdown, no bullets, no headings.
- 2-4 short sentences. Optimised to be read on a phone.
- Open with the client's first name when known; close with the agent's first name.
- Tone: warm, professional, never pushy. Optional polite greeting in Urdu only at the open ("Assalam-o-Alaikum") if appropriate.
- Reference one concrete thing from the lead's state (their budget, area preference, the property they enquired about, their last visit) so the message reads personal not generic.
- Currency: PKR. Areas: as supplied (MARLA/KANAL/SQFT). Don't convert.
- Never invent property details, prices, or appointment times the agent didn't supply.
- End with a soft call to action ("Would tomorrow at 4pm work for a quick visit?" / "Should I send 2-3 fresh listings matching this budget?").
- Do not wrap the message in quotes or backticks.`;

export interface LeadReplyDraftInput {
  companyId: string;
  leadId: string;
  /**
   * Optional steering note from the agent ("focus on the budget concern",
   * "they cancelled yesterday's visit"). Feeds into the user turn so the
   * agent can produce variants without re-fetching the whole context.
   */
  steer?: string;
}

export async function draftLeadReply(
  input: LeadReplyDraftInput,
): Promise<AiCallResult | AiCallFailure> {
  const lead = await prisma.lead.findFirst({
    where: { id: input.leadId, companyId: input.companyId },
    include: {
      client: { select: { name: true } },
      agent: { select: { name: true } },
      property: { select: { title: true, area: true, city: true } },
      showings: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { interestLevel: true, notes: true },
      },
    },
  });
  if (!lead) return { ok: false, reason: "Lead not found." };

  // Pull the workspace's signature override so the model can sign off
  // consistently with manual WhatsApp templates.
  const company = await prisma.company.findUnique({
    where: { id: input.companyId },
    select: { name: true, whatsappSignature: true },
  });

  const inputs: Record<string, unknown> = {
    client_first_name: (lead.client?.name ?? "").split(" ")[0] || "there",
    agent_first_name: (lead.agent?.name ?? "").split(" ")[0] || "the team",
    company: company?.name ?? "our office",
    stage: lead.stage,
    signature_override: company?.whatsappSignature ?? "",
  };
  if (lead.prefArea) inputs.preferred_area = lead.prefArea;
  if (lead.prefType) inputs.preferred_type = lead.prefType;
  if (lead.budgetMax) inputs.budget_pkr_max = lead.budgetMax.toString();
  if (lead.property) inputs.linked_property = lead.property.title;
  if (lead.showings.length > 0) {
    const s = lead.showings[0];
    inputs.last_visit_interest = s.interestLevel ?? "unknown";
    if (s.notes) inputs.last_visit_notes = s.notes.slice(0, 200);
  }

  const promptParts = ["Draft a WhatsApp reply this agent can send right now."];
  if (input.steer) promptParts.push(`Steering: ${input.steer.slice(0, 240)}`);

  return runAi({
    companyId: input.companyId,
    type: "LEAD_REPLY_DRAFT",
    entity: { type: "LEAD", id: input.leadId },
    system: SYSTEM,
    prompt: promptParts.join("\n"),
    inputs,
    maxTokens: 300,
    // Drafts are personal — a stale 30-minute cache would surprise the
    // agent who just clicked "regenerate". Tight window keeps the cache
    // useful for accidental double-clicks but lets fresh runs go through.
    cacheTtlMs: 60_000,
  });
}
