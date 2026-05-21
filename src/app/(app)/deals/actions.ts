"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCompanyUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { logActivity, notify } from "@/lib/activity";
import { computeCommission } from "@/lib/commission";
import { toNumber } from "@/lib/format";

const dealSchema = z.object({
  propertyId: z.string().min(1, "Property is required"),
  type: z.enum(["SALE", "RENTAL"]),
  clientId: z.string().optional(),
  dealerId: z.string().optional(),
  mainAgentId: z.string().min(1, "A main agent is required"),
  coAgentIds: z.array(z.string()).optional(),
  amount: z.coerce.number().nonnegative(),
  deposit: z.coerce.number().nonnegative().optional(),
  leaseMonths: z.coerce.number().int().nonnegative().optional(),
});

export type FormState = { error?: string; fieldErrors?: Record<string, string[]> };

const dec = (v?: number) => (v === undefined || Number.isNaN(v) ? null : new Prisma.Decimal(v));

async function nextDealRef(companyId: string): Promise<string> {
  const count = await prisma.deal.count({ where: { companyId } });
  return `DEAL-${String(count + 1).padStart(4, "0")}`;
}

export async function createDeal(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireCompanyUser();
  if (!can(user.role, "recordDeals")) return { error: "Not allowed." };

  const raw = Object.fromEntries(formData);
  const coAgentIds = formData.getAll("coAgentIds").map(String).filter(Boolean);
  const parsed = dealSchema.safeParse({ ...raw, coAgentIds });
  if (!parsed.success) {
    return { error: "Please fix the errors below.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const d = parsed.data;

  const agentLinks: Prisma.DealAgentCreateWithoutDealInput[] = [
    { agent: { connect: { id: d.mainAgentId } }, role: "MAIN" },
    ...coAgentIds
      .filter((id) => id !== d.mainAgentId)
      .map((id) => ({ agent: { connect: { id } }, role: "CO_AGENT" as const })),
  ];

  const deal = await prisma.deal.create({
    data: {
      companyId: user.companyId,
      reference: await nextDealRef(user.companyId),
      type: d.type,
      status: "DRAFT",
      propertyId: d.propertyId,
      clientId: d.clientId || null,
      dealerId: d.dealerId || null,
      agents: { create: agentLinks },
      ...(d.type === "SALE"
        ? { sale: { create: { salePrice: new Prisma.Decimal(d.amount) } } }
        : {
            rental: {
              create: {
                monthlyRent: new Prisma.Decimal(d.amount),
                deposit: dec(d.deposit),
                leaseMonths: d.leaseMonths ?? null,
              },
            },
          }),
    },
  });

  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: "deal.created",
    entityType: "DEAL",
    entityId: deal.id,
    summary: `Created ${d.type.toLowerCase()} deal ${deal.reference}`,
  });

  revalidatePath("/deals");
  redirect(`/deals/${deal.id}`);
}

export async function setDealStatus(formData: FormData): Promise<void> {
  const user = await requireCompanyUser();
  if (!can(user.role, "recordDeals")) return;

  const id = String(formData.get("id"));
  const status = String(formData.get("status")) as Prisma.DealUpdateInput["status"];

  const deal = await prisma.deal.findFirst({ where: { id, companyId: user.companyId }, include: { property: true } });
  if (!deal) return;

  await prisma.deal.update({
    where: { id },
    data: { status, closeDate: status === "CLOSED_WON" ? new Date() : deal.closeDate },
  });

  // Reflect closure on the property.
  if (status === "CLOSED_WON") {
    await prisma.property.update({
      where: { id: deal.propertyId },
      data: { status: deal.type === "SALE" ? "SOLD" : "RENTED" },
    });
  }

  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: "deal.status",
    entityType: "DEAL",
    entityId: id,
    summary: `Deal ${deal.reference} → ${String(status)}`,
  });
  revalidatePath(`/deals/${id}`);
  revalidatePath("/deals");
}

/**
 * Builds the commission record for a deal from its property's rule
 * (or the company default), splitting `total` across the parties.
 */
export async function generateCommission(formData: FormData): Promise<void> {
  const user = await requireCompanyUser();
  if (!can(user.role, "recordDeals")) return;

  const dealId = String(formData.get("dealId"));
  const total = Number(formData.get("total"));
  if (!total || Number.isNaN(total)) return;

  const deal = await prisma.deal.findFirst({
    where: { id: dealId, companyId: user.companyId },
    include: {
      property: { include: { commissionRule: true } },
      dealer: true,
      agents: { include: { agent: true } },
      commission: true,
    },
  });
  if (!deal || deal.commission) return;

  const rule =
    deal.property.commissionRule ??
    (await prisma.commissionRule.findFirst({ where: { companyId: user.companyId, isDefault: true } }));
  if (!rule) return;

  const main = deal.agents.find((a) => a.role === "MAIN")?.agent ?? null;
  const others = deal.agents.filter((a) => a.role === "CO_AGENT").map((a) => a.agent);

  const shares = computeCommission(
    {
      mainAgentPct: toNumber(rule.mainAgentPct),
      companyPct: toNumber(rule.companyPct),
      otherAgentPct: toNumber(rule.otherAgentPct),
      dealerPct: toNumber(rule.dealerPct),
      noOtherFallback: rule.noOtherFallback === "COMPANY" ? "COMPANY" : "MAIN",
    },
    {
      total,
      mainAgent: main ? { id: main.id, name: main.name } : null,
      otherAgents: others.map((o) => ({ id: o.id, name: o.name })),
      dealer: deal.dealer ? { id: deal.dealer.id, name: deal.dealer.name } : null,
    },
  );

  await prisma.commission.create({
    data: {
      companyId: user.companyId,
      dealId: deal.id,
      totalAmount: new Prisma.Decimal(total),
      status: "PENDING_APPROVAL",
      shares: {
        create: shares.map((s) => ({
          party: s.party,
          userId: s.userId ?? null,
          dealerId: s.dealerId ?? null,
          label: s.label,
          pct: new Prisma.Decimal(s.pct),
          amount: new Prisma.Decimal(s.amount),
        })),
      },
    },
  });

  // Notify owners/admins that an approval is waiting.
  const approvers = await prisma.user.findMany({
    where: { companyId: user.companyId, role: { in: ["OWNER", "ADMIN"] } },
    select: { id: true },
  });
  await Promise.all(
    approvers.map((a) =>
      notify({
        companyId: user.companyId,
        userId: a.id,
        type: "COMMISSION_APPROVAL",
        title: `Commission to approve — ${deal.reference}`,
        link: `/commissions`,
      }),
    ),
  );

  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: "commission.generated",
    entityType: "DEAL",
    entityId: deal.id,
    summary: `Commission generated for ${deal.reference}`,
  });
  revalidatePath(`/deals/${dealId}`);
  revalidatePath("/commissions");
}
