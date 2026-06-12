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
import { invalidateCompanyMetrics } from "@/lib/metrics";
import { toNumber, humanize } from "@/lib/format";
import { setFlash } from "@/lib/flash";
import { nextDealReference } from "@/lib/refs";
import { initiateContractPipelines } from "@/lib/contract-service";

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

// nextDealRef removed — superseded by lib/refs.ts:nextDealReference, which
// uses Company.refPrefix so each tenant gets distinguishable references
// (`CHR-D-0001` vs `UEP-D-0001`) instead of every tenant starting at DEAL-0001.
// Platform fallback prefix is `PROP` for tenants with no name set.

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

  const dataBase = {
    companyId: user.companyId,
    type: d.type,
    status: "DRAFT" as const,
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
  };

  // Same retry-on-P2002 pattern as createProperty + createInvoice — handles
  // the narrow race between MAX-lookup and INSERT under concurrent traffic.
  let deal: Awaited<ReturnType<typeof prisma.deal.create>> | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      deal = await prisma.deal.create({
        data: { ...dataBase, reference: await nextDealReference(user.companyId) },
      });
      break;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
      throw e;
    }
  }
  if (!deal) return { error: "Could not allocate a deal reference. Try again." };

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
  const lostReason = (formData.get("lostReason") ? String(formData.get("lostReason")) : "").trim();

  const deal = await prisma.deal.findFirst({ where: { id, companyId: user.companyId }, include: { property: true } });
  if (!deal) return;

  // Hard-require a reason on CLOSED_LOST. HTML5 `required` on the input is
  // the primary UX; this is the server-side backstop.
  if (status === "CLOSED_LOST" && !lostReason) return;

  const isClosed = status === "CLOSED_WON" || status === "CLOSED_LOST";
  await prisma.deal.update({
    where: { id },
    data: {
      status,
      closeDate: status === "CLOSED_WON" ? new Date() : deal.closeDate,
      // Capture the reason on LOST; clear it if the deal is reopened later.
      lostReason: status === "CLOSED_LOST" ? lostReason : isClosed ? deal.lostReason : null,
    },
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
    action: status === "CLOSED_LOST" ? "deal.lost" : "deal.status",
    entityType: "DEAL",
    entityId: id,
    summary: status === "CLOSED_LOST"
      ? `Deal ${deal.reference} lost — ${lostReason}`
      : `Deal ${deal.reference} → ${String(status)}`,
    meta: {
      from: deal.status,
      to: String(status),
      ...(status === "CLOSED_LOST" ? { lostReason } : {}),
    },
  });
  await setFlash({
    tone: status === "CLOSED_LOST" ? "warn" : status === "CLOSED_WON" ? "ok" : "info",
    message: status === "CLOSED_LOST"
      ? `${deal.reference} marked lost.`
      : status === "CLOSED_WON"
        ? `${deal.reference} closed — property auto-marked ${deal.type === "SALE" ? "SOLD" : "RENTED"}.`
        : `${deal.reference}: ${humanize(String(status))}.`,
  });
  invalidateCompanyMetrics(user.companyId);
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
  invalidateCompanyMetrics(user.companyId);
  revalidatePath(`/deals/${dealId}`);
  revalidatePath("/commissions");
}

/**
 * Start the rental CNIC e-sign pipeline for a deal: create the Contract (if not
 * already present) and dispatch the landlord + renter verify links over
 * WhatsApp. Office-only (recordDeals); tenant-scoped. Non-fatal delivery issues
 * surface as a `warn` flash with the links so the agent can share manually.
 */
export async function startRentalContract(formData: FormData): Promise<void> {
  const user = await requireCompanyUser();
  if (!can(user.role, "recordDeals")) return;

  const dealId = String(formData.get("dealId") || "");
  if (!dealId) return;

  // Scope: the deal must belong to this tenant before we touch it.
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, companyId: user.companyId },
    select: { id: true, type: true, reference: true },
  });
  if (!deal) return;
  if (deal.type !== "RENTAL") {
    await setFlash({ tone: "danger", message: "CNIC contracts are only available on rental deals." });
    revalidatePath(`/deals/${dealId}`);
    return;
  }

  try {
    const res = await initiateContractPipelines(dealId);
    await logActivity({
      companyId: user.companyId,
      userId: user.id,
      action: "contract.initiated",
      entityType: "DEAL",
      entityId: dealId,
      summary: `Started CNIC e-sign for ${deal.reference}`,
      meta: { contractId: res.contractId, landlordSent: res.landlordSent, renterSent: res.renterSent },
    });
    if (res.warnings.length > 0) {
      await setFlash({ tone: "warn", message: res.warnings.join(" ") });
    } else {
      await setFlash({ tone: "ok", message: "CNIC verification links sent to the landlord and renter." });
    }
  } catch (e) {
    await setFlash({ tone: "danger", message: e instanceof Error ? e.message : "Could not start the contract." });
  }
  revalidatePath(`/deals/${dealId}`);
}
