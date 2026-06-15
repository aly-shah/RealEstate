"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCompanyUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { logActivity, notify } from "@/lib/activity";
import { humanize } from "@/lib/format";
import { scheduleAutoFollowUp } from "@/lib/lead-followups";
import { routeForCompany } from "@/lib/lead-router";
import { enrollLeadInSequences } from "@/lib/drip";
import { newShareSlug } from "@/lib/share";
import { setFlash } from "@/lib/flash";

const leadSchema = z.object({
  clientName: z.string().min(2, "Client name is required"),
  clientPhone: z.string().optional(),
  clientEmail: z.string().email().optional().or(z.literal("")),
  source: z.enum(["REFERRAL", "WALK_IN", "SOCIAL_MEDIA", "PORTAL", "CALL", "REPEAT_CLIENT", "OTHER"]),
  agentId: z.string().optional(),
  propertyId: z.string().optional(),
  budgetMin: z.coerce.number().nonnegative().optional(),
  budgetMax: z.coerce.number().nonnegative().optional(),
  prefArea: z.string().optional(),
  requirements: z.string().optional(),
});

export type FormState = { error?: string; fieldErrors?: Record<string, string[]> };

const dec = (v?: number) => (v === undefined || Number.isNaN(v) ? null : new Prisma.Decimal(v));

export async function createLead(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireCompanyUser();
  if (!can(user.role, "updateLeadsVisits")) return { error: "Not allowed." };

  const parsed = leadSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: "Please fix the errors below.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const d = parsed.data;

  // Agents create leads assigned to themselves; office roles may pick an agent.
  const agentId = user.role === "AGENT" ? user.id : d.agentId || null;

  // De-dup: prefer phone match (most reliable), then email. Within the same
  // company only. If multiple candidates match, pick the most recently used —
  // safer than picking arbitrarily and produces a stable "this is the same
  // person" result for ops staff. Backfill missing fields from this lead.
  const phone = d.clientPhone?.trim() || null;
  const email = d.clientEmail?.trim().toLowerCase() || null;

  let client: Awaited<ReturnType<typeof prisma.client.findFirst>> = null;
  let reusedExisting = false;
  if (phone || email) {
    client = await prisma.client.findFirst({
      where: {
        companyId: user.companyId,
        OR: [
          ...(phone ? [{ phone }] : []),
          ...(email ? [{ email }] : []),
        ],
      },
      orderBy: { createdAt: "desc" },
    });
  }

  if (client) {
    reusedExisting = true;
    // Backfill any field the existing client is missing — never overwrite.
    const updates: Record<string, string> = {};
    if (!client.phone && phone) updates.phone = phone;
    if (!client.email && email) updates.email = email;
    if (!client.name && d.clientName) updates.name = d.clientName;
    if (Object.keys(updates).length > 0) {
      client = await prisma.client.update({ where: { id: client.id }, data: updates });
    }
  } else {
    client = await prisma.client.create({
      data: {
        companyId: user.companyId,
        name: d.clientName,
        phone,
        email,
      },
    });
  }
  // Both branches assign — narrow for the rest of the function.
  const linkedClient = client!;

  const lead = await prisma.lead.create({
    data: {
      companyId: user.companyId,
      clientId: linkedClient.id,
      agentId,
      propertyId: d.propertyId || null,
      source: d.source,
      budgetMin: dec(d.budgetMin),
      budgetMax: dec(d.budgetMax),
      prefArea: d.prefArea || null,
      requirements: d.requirements || null,
    },
  });

  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: "lead.created",
    entityType: "LEAD",
    entityId: lead.id,
    summary: reusedExisting
      ? `New lead for existing client ${linkedClient.name} (${humanize(d.source)})`
      : `New lead: ${linkedClient.name} (${humanize(d.source)})`,
    meta: { clientReused: reusedExisting, clientId: linkedClient.id },
  });

  if (agentId && agentId !== user.id) {
    await notify({
      companyId: user.companyId,
      userId: agentId,
      type: "LEAD_ASSIGNED",
      title: "New lead assigned to you",
      body: linkedClient.name,
      link: `/leads/${lead.id}`,
    });
  }

  // Auto-route an unassigned lead per the company's configured strategy. The
  // engine assigns + notifies + schedules its own follow-up, so the agentId-
  // guarded blocks below stay no-ops here. MANUAL (default) → skipped.
  if (!agentId) {
    await routeForCompany(lead.id, user.companyId);
  }

  // Enroll into any drip sequence triggered by the lead's starting stage.
  await enrollLeadInSequences(lead.id);

  // Phase 4: auto-schedule the first follow-up. No-op when there's no agent
  // assigned yet (office can pick "Unassigned" — a later assignment will trigger).
  const followUpId = await scheduleAutoFollowUp({
    leadId: lead.id,
    companyId: user.companyId,
    agentId,
    stage: lead.stage,
    clientName: linkedClient.name,
  });
  if (followUpId) {
    await logActivity({
      companyId: user.companyId,
      userId: user.id,
      action: "lead.followup_scheduled",
      entityType: "LEAD",
      entityId: lead.id,
      summary: `Auto follow-up scheduled for ${linkedClient.name}`,
      meta: { eventId: followUpId, stage: lead.stage },
    });
  }

  revalidatePath("/leads");
  redirect(`/leads/${lead.id}`);
}

export async function advanceStage(formData: FormData): Promise<void> {
  const user = await requireCompanyUser();
  const id = String(formData.get("id"));
  const stage = String(formData.get("stage")) as Prisma.LeadUpdateInput["stage"];
  const lostReason = formData.get("lostReason") ? String(formData.get("lostReason")) : null;

  const lead = await prisma.lead.findFirst({ where: { id, companyId: user.companyId } });
  if (!lead) return;
  // Agents can only move their own leads.
  if (user.role === "AGENT" && lead.agentId !== user.id) return;

  if (lead.stage === stage) return; // no-op; avoids log noise

  await prisma.lead.update({
    where: { id },
    data: { stage, lostReason: stage === "CLOSED_LOST" ? lostReason : null },
  });
  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: "lead.stage",
    entityType: "LEAD",
    entityId: id,
    summary: `Stage → ${humanize(String(stage))}`,
    meta: {
      from: lead.stage,
      to: String(stage),
      ...(stage === "CLOSED_LOST" && lostReason ? { lostReason } : {}),
    },
  });

  // Enroll into any drip sequence triggered by the NEW stage (deduped per
  // sequence). enrollLeadInSequences no-ops for the closed stages.
  await enrollLeadInSequences(id);

  // Phase 4: when a lead progresses to CONTACTED or INTERESTED, ensure
  // there's a future follow-up on the calendar. The helper dedup-checks
  // existing events so re-running the same stage transition is harmless.
  if ((stage === "CONTACTED" || stage === "INTERESTED") && lead.agentId) {
    const client = lead.clientId
      ? await prisma.client.findUnique({ where: { id: lead.clientId }, select: { name: true } })
      : null;
    const eventId = await scheduleAutoFollowUp({
      leadId: id,
      companyId: user.companyId,
      agentId: lead.agentId,
      stage: stage as "CONTACTED" | "INTERESTED",
      clientName: client?.name ?? null,
    });
    if (eventId) {
      await logActivity({
        companyId: user.companyId,
        userId: user.id,
        action: "lead.followup_scheduled",
        entityType: "LEAD",
        entityId: id,
        summary: `Auto follow-up scheduled (${humanize(String(stage))})`,
        meta: { eventId, stage: String(stage) },
      });
    }
  }

  revalidatePath(`/leads/${id}`);
  revalidatePath("/leads");
}

/**
 * Office-only — pin the lead's hot/warm/cold band, or clear back to "auto".
 * The Lead row carries the override; computation lives in lib/lead-score.ts.
 */
export async function setLeadScoreOverride(formData: FormData): Promise<void> {
  const user = await requireCompanyUser();
  if (!can(user.role, "assignLeadsCalendars")) return;

  const id = String(formData.get("leadId"));
  const raw = String(formData.get("override") || "");
  // Empty string clears the override (back to auto).
  const next = raw === "HOT" || raw === "WARM" || raw === "COLD" ? raw : null;

  const lead = await prisma.lead.findFirst({
    where: { id, companyId: user.companyId },
    select: { scoreOverride: true },
  });
  if (!lead) return;
  if (lead.scoreOverride === next) return; // no-op

  await prisma.lead.update({ where: { id }, data: { scoreOverride: next } });
  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: "lead.score_override",
    entityType: "LEAD",
    entityId: id,
    summary: next ? `Pinned score to ${next}` : "Cleared score override",
    meta: { from: lead.scoreOverride, to: next },
  });
  revalidatePath(`/leads/${id}`);
  revalidatePath("/leads");
}

/**
 * Attach a suggested property to a lead — used by the PropertyMatches list
 * on the lead detail page. Tenant-checks both records before writing.
 */
export async function attachPropertyToLead(formData: FormData): Promise<void> {
  const user = await requireCompanyUser();
  if (!can(user.role, "updateLeadsVisits")) return;

  const leadId = String(formData.get("leadId"));
  const propertyId = String(formData.get("propertyId"));
  if (!leadId || !propertyId) return;

  const [lead, property] = await Promise.all([
    prisma.lead.findFirst({ where: { id: leadId, companyId: user.companyId } }),
    prisma.property.findFirst({
      where: { id: propertyId, companyId: user.companyId },
      select: { id: true, reference: true, title: true },
    }),
  ]);
  if (!lead || !property) return;
  // Agents only get to touch their own leads (matches existing advanceStage gate).
  if (user.role === "AGENT" && lead.agentId !== user.id) return;
  if (lead.propertyId === propertyId) return; // already linked

  await prisma.lead.update({ where: { id: leadId }, data: { propertyId } });
  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: "lead.attach_property",
    entityType: "LEAD",
    entityId: leadId,
    summary: `Attached ${property.reference} — ${property.title}`,
    meta: { from: lead.propertyId, to: propertyId },
  });
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
}

export async function assignAgent(formData: FormData): Promise<void> {
  const user = await requireCompanyUser();
  if (!can(user.role, "assignLeadsCalendars")) return;

  const id = String(formData.get("id"));
  const agentId = String(formData.get("agentId")) || null;

  const lead = await prisma.lead.findFirst({ where: { id, companyId: user.companyId } });
  if (!lead) return;

  await prisma.lead.update({ where: { id }, data: { agentId } });
  let assignedName: string | null = null;
  if (agentId) {
    const agent = await prisma.user.findUnique({ where: { id: agentId }, select: { name: true } });
    assignedName = agent?.name ?? null;
    await notify({
      companyId: user.companyId,
      userId: agentId,
      type: "LEAD_ASSIGNED",
      title: "A lead was assigned to you",
      link: `/leads/${id}`,
    });
  }
  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: "lead.assign",
    entityType: "LEAD",
    entityId: id,
    summary: "Lead reassigned",
  });
  await setFlash({
    tone: "ok",
    message: assignedName ? `Lead reassigned to ${assignedName}.` : "Lead set to unassigned.",
  });
  revalidatePath(`/leads/${id}`);
}

/**
 * Set or clear a client's marketing opt-out (DNC) from the lead page. Opting out
 * stamps the source/time and exits the client's active drip sequences across all
 * their leads; re-subscribing clears the flags. Gated by updateLeadsVisits +
 * lead scope (an agent can only manage their own lead's client).
 */
export async function setClientConsent(formData: FormData): Promise<void> {
  const user = await requireCompanyUser();
  if (!can(user.role, "updateLeadsVisits")) return;

  const leadId = String(formData.get("leadId") || "");
  const optOut = String(formData.get("optOut")) === "true";
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, companyId: user.companyId },
    select: { id: true, clientId: true, agentId: true },
  });
  if (!lead || !lead.clientId) return;
  if (user.role === "AGENT" && lead.agentId !== user.id) return; // own leads only

  await prisma.client.update({
    where: { id: lead.clientId },
    data: {
      marketingOptOut: optOut,
      optOutAt: optOut ? new Date() : null,
      optOutSource: optOut ? "manual" : null,
    },
  });

  if (optOut) {
    // Exit the client's active sequences across all their leads (leadId-indexed).
    const leadIds = (
      await prisma.lead.findMany({ where: { companyId: user.companyId, clientId: lead.clientId }, select: { id: true } })
    ).map((l) => l.id);
    if (leadIds.length > 0) {
      await prisma.dripEnrollment.updateMany({
        where: { leadId: { in: leadIds }, status: "ACTIVE" },
        data: { status: "EXITED" },
      });
    }
  }

  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: optOut ? "client.opted_out" : "client.resubscribed",
    entityType: "CLIENT",
    entityId: lead.clientId,
    summary: optOut ? "Client opted out of marketing (DNC)" : "Client re-subscribed to marketing",
  });
  await setFlash({ tone: "ok", message: optOut ? "Marked do-not-contact." : "Re-subscribed." });
  revalidatePath(`/leads/${leadId}`);
}

/**
 * Enable/disable the login-free client portal for a lead's client. Mints an
 * unguessable token on first enable and reuses it thereafter (toggling off then
 * on keeps the same URL). Gated by updateLeadsVisits + lead scope.
 */
export async function setClientPortal(formData: FormData): Promise<void> {
  const user = await requireCompanyUser();
  if (!can(user.role, "updateLeadsVisits")) return;

  const leadId = String(formData.get("leadId") || "");
  const enabled = String(formData.get("enabled")) === "true";
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, companyId: user.companyId },
    select: { id: true, clientId: true, agentId: true },
  });
  if (!lead || !lead.clientId) return;
  if (user.role === "AGENT" && lead.agentId !== user.id) return;

  const client = await prisma.client.findUnique({
    where: { id: lead.clientId },
    select: { portalToken: true, portalEnabled: true },
  });
  if (!client) return;
  if (client.portalEnabled === enabled && client.portalToken) {
    revalidatePath(`/leads/${leadId}`);
    return; // no-op
  }

  await prisma.client.update({
    where: { id: lead.clientId },
    data: { portalEnabled: enabled, portalToken: client.portalToken ?? newShareSlug() },
  });
  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: enabled ? "client.portal_enabled" : "client.portal_disabled",
    entityType: "CLIENT",
    entityId: lead.clientId,
    summary: `${enabled ? "Enabled" : "Disabled"} client portal`,
  });
  revalidatePath(`/leads/${leadId}`);
}
