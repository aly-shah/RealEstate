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

  const client = await prisma.client.create({
    data: {
      companyId: user.companyId,
      name: d.clientName,
      phone: d.clientPhone || null,
      email: d.clientEmail || null,
    },
  });

  const lead = await prisma.lead.create({
    data: {
      companyId: user.companyId,
      clientId: client.id,
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
    summary: `New lead: ${client.name} (${humanize(d.source)})`,
  });

  if (agentId && agentId !== user.id) {
    await notify({
      companyId: user.companyId,
      userId: agentId,
      type: "LEAD_ASSIGNED",
      title: "New lead assigned to you",
      body: client.name,
      link: `/leads/${lead.id}`,
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
  });
  revalidatePath(`/leads/${id}`);
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
  if (agentId) {
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
  revalidatePath(`/leads/${id}`);
}
