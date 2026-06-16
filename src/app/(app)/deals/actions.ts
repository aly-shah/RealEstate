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
import { initiateContractPipelines, ensureContractForDeal } from "@/lib/contract-service";
import { syncDealDocuments } from "@/lib/deal-documents";

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
  // GCI input — gross commission as a % of the deal value (drives the GCI +
  // forecast reports). Optional; defaults to 0 when omitted.
  grossCommissionPercentage: z.coerce.number().min(0).max(100).optional(),
  // Forward-looking forecast date (YYYY-MM-DD from a date input).
  estimatedCloseDate: z.string().optional(),
});

export type FormState = { error?: string; fieldErrors?: Record<string, string[]> };

const dec = (v?: number) => (v === undefined || Number.isNaN(v) ? null : new Prisma.Decimal(v));

// Default closing-checklist items per deal type. Required items must be done
// before the deal can be marked CLOSED_WON (the compliance gate in setDealStatus).
const DEFAULT_CHECKLIST: Record<"SALE" | "RENTAL", { label: string; required: boolean }[]> = {
  SALE: [
    { label: "Buyer CNIC", required: true },
    { label: "Seller CNIC", required: true },
    { label: "Ownership / title document", required: true },
    { label: "Sale agreement signed", required: true },
    { label: "Transfer / NOC documents", required: true },
    { label: "Booking / token receipt", required: false },
  ],
  RENTAL: [
    { label: "Tenant CNIC", required: true },
    { label: "Owner CNIC", required: true },
    { label: "Rental agreement signed", required: true },
    { label: "Security deposit received", required: true },
    { label: "Guarantor details", required: false },
  ],
};

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
    grossCommissionPercentage: new Prisma.Decimal(d.grossCommissionPercentage ?? 0),
    estimatedCloseDate: d.estimatedCloseDate ? new Date(d.estimatedCloseDate) : null,
    agents: { create: agentLinks },
    // Seed the default closing checklist for the deal type — the office can
    // adjust it; required items gate CLOSED_WON (see setDealStatus).
    checklist: { create: DEFAULT_CHECKLIST[d.type].map((it, i) => ({ ...it, order: i })) },
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

  // Compliance gate: a deal can't be CLOSED_WON while required checklist items
  // are still pending. This is the server-side enforcement — the deal page also
  // shows the blocker and disables the control.
  if (status === "CLOSED_WON") {
    const pending = await prisma.dealChecklistItem.count({
      where: { dealId: id, required: true, done: false },
    });
    if (pending > 0) {
      await setFlash({
        tone: "danger",
        message: `Can't close — ${pending} required checklist item${pending === 1 ? "" : "s"} still pending.`,
      });
      revalidatePath(`/deals/${id}`);
      return;
    }
  }

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
export async function startContract(formData: FormData): Promise<void> {
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

  // Works for both deal types — sale agreements and rental leases.
  const parties = deal.type === "SALE" ? "seller and buyer" : "landlord and renter";

  try {
    const res = await initiateContractPipelines(dealId);
    await logActivity({
      companyId: user.companyId,
      userId: user.id,
      action: "contract.initiated",
      entityType: "DEAL",
      entityId: dealId,
      summary: `Started CNIC e-sign for ${deal.reference}`,
      meta: { contractId: res.contractId, type: deal.type, landlordSent: res.landlordSent, renterSent: res.renterSent },
    });
    if (res.warnings.length > 0) {
      await setFlash({ tone: "warn", message: res.warnings.join(" ") });
    } else {
      await setFlash({ tone: "ok", message: `CNIC verification links sent to the ${parties}.` });
    }
  } catch (e) {
    await setFlash({ tone: "danger", message: e instanceof Error ? e.message : "Could not start the contract." });
  }
  revalidatePath(`/deals/${dealId}`);
}

/** Generate (or refresh) the deal's printable document pack — agreement,
 *  receipt and possession note — as Document rows in the Documents tab. */
export async function generateDealDocuments(formData: FormData): Promise<void> {
  const user = await requireCompanyUser();
  if (!can(user.role, "recordDeals")) return;

  const dealId = String(formData.get("dealId") || "");
  if (!dealId) return;
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, companyId: user.companyId },
    select: { id: true, reference: true },
  });
  if (!deal) return;

  try {
    const count = await syncDealDocuments(dealId);
    await logActivity({
      companyId: user.companyId,
      userId: user.id,
      action: "documents.generated",
      entityType: "DEAL",
      entityId: dealId,
      summary: `Generated ${count} documents for ${deal.reference}`,
    });
    await setFlash({ tone: "ok", message: `Generated ${count} documents — find them in the Documents list.` });
  } catch (e) {
    await setFlash({ tone: "danger", message: e instanceof Error ? e.message : "Could not generate documents." });
  }
  revalidatePath(`/deals/${dealId}`);
  revalidatePath("/documents");
}

const optionalMoney = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z.coerce.number().min(0).max(1_000_000_000_000).optional(),
);
const optionalDate = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.string().optional());

const contractSchema = z.object({
  // SALE terms
  salePrice: optionalMoney,
  tokenAmount: optionalMoney,
  downPayment: optionalMoney,
  // RENTAL terms
  monthlyRent: optionalMoney,
  deposit: optionalMoney,
  leaseMonths: z.preprocess(
    (v) => (v === "" || v == null ? undefined : v),
    z.coerce.number().int().min(0).max(600).optional(),
  ),
  startDate: optionalDate,
  endDate: optionalDate,
  possessionDate: optionalDate,
  // Parties (operator can override the OCR-captured identity)
  landlordCnicName: z.string().max(120).optional(),
  landlordCnic: z.string().max(20).optional(),
  renterCnicName: z.string().max(120).optional(),
  renterCnic: z.string().max(20).optional(),
  // Free-text special clauses appended to the agreement
  customClauses: z.string().max(5000).optional(),
});

/** Operator-edit the contract terms, parties and clauses for a single deal.
 *  Ensures the contract exists first, so this also works before links are sent. */
export async function updateContract(formData: FormData): Promise<void> {
  const user = await requireCompanyUser();
  if (!can(user.role, "recordDeals")) return;

  const dealId = String(formData.get("dealId") || "");
  if (!dealId) return;
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, companyId: user.companyId },
    select: { id: true },
  });
  if (!deal) return;

  const parsed = contractSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    await setFlash({ tone: "danger", message: parsed.error.issues[0]?.message ?? "Invalid contract input." });
    revalidatePath(`/deals/${dealId}`);
    return;
  }
  const d = parsed.data;

  try {
    await ensureContractForDeal(dealId);
    const dec = (n: number | undefined) => (n == null ? null : new Prisma.Decimal(n));
    const date = (s: string | undefined) => (s ? new Date(s) : null);
    const text = (s: string | undefined) => (s && s.trim() ? s.trim() : null);

    await prisma.contract.update({
      where: { dealId },
      data: {
        salePrice: dec(d.salePrice),
        tokenAmount: dec(d.tokenAmount),
        downPayment: dec(d.downPayment),
        monthlyRent: dec(d.monthlyRent),
        deposit: dec(d.deposit),
        leaseMonths: d.leaseMonths ?? null,
        startDate: date(d.startDate),
        endDate: date(d.endDate),
        possessionDate: date(d.possessionDate),
        landlordCnicName: text(d.landlordCnicName),
        landlordCnic: text(d.landlordCnic),
        renterCnicName: text(d.renterCnicName),
        renterCnic: text(d.renterCnic),
        customClauses: text(d.customClauses),
      },
    });
    await logActivity({
      companyId: user.companyId,
      userId: user.id,
      action: "contract.updated",
      entityType: "DEAL",
      entityId: dealId,
      summary: `Edited contract terms for deal ${dealId}`,
    });
    await setFlash({ tone: "ok", message: "Contract updated. Regenerate the documents to apply the changes." });
  } catch (e) {
    await setFlash({ tone: "danger", message: e instanceof Error ? e.message : "Could not update the contract." });
  }
  revalidatePath(`/deals/${dealId}`);
}

const dealForecastSchema = z.object({
  grossCommissionPercentage: z.coerce.number().min(0).max(100).optional(),
  estimatedCloseDate: z.string().optional(),
});

/**
 * Inline editor on the deal page — set/backfill the gross commission % and the
 * estimated close date so existing deals feed the GCI + pipeline-forecast
 * reports. Office-only (recordDeals), tenant-scoped. Invalidates the metrics
 * cache so the dashboards/reports reflect it.
 */
export async function updateDealForecast(formData: FormData): Promise<void> {
  const user = await requireCompanyUser();
  if (!can(user.role, "recordDeals")) return;

  const id = String(formData.get("id") || "");
  if (!id) return;
  const deal = await prisma.deal.findFirst({
    where: { id, companyId: user.companyId },
    select: { id: true, reference: true },
  });
  if (!deal) return;

  const parsed = dealForecastSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    await setFlash({ tone: "danger", message: "Enter a gross commission % between 0 and 100." });
    revalidatePath(`/deals/${id}`);
    return;
  }
  const d = parsed.data;

  await prisma.deal.update({
    where: { id },
    data: {
      grossCommissionPercentage: new Prisma.Decimal(d.grossCommissionPercentage ?? 0),
      estimatedCloseDate: d.estimatedCloseDate ? new Date(d.estimatedCloseDate) : null,
    },
  });
  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: "deal.forecast_updated",
    entityType: "DEAL",
    entityId: id,
    summary: `Updated gross commission % for ${deal.reference}`,
    meta: { grossCommissionPercentage: d.grossCommissionPercentage ?? 0 },
  });
  invalidateCompanyMetrics(user.companyId);
  await setFlash({ tone: "ok", message: "Saved." });
  revalidatePath(`/deals/${id}`);
}

/** Toggle a checklist item done/undone. recordDeals-gated, tenant-scoped. */
export async function toggleChecklistItem(formData: FormData): Promise<void> {
  const user = await requireCompanyUser();
  if (!can(user.role, "recordDeals")) return;
  const id = String(formData.get("id") || "");
  const item = await prisma.dealChecklistItem.findFirst({
    where: { id, deal: { companyId: user.companyId } },
    select: { id: true, done: true, dealId: true },
  });
  if (!item) return;
  await prisma.dealChecklistItem.update({
    where: { id },
    data: { done: !item.done, doneAt: !item.done ? new Date() : null },
  });
  revalidatePath(`/deals/${item.dealId}`);
}

/** Add a custom checklist item to a deal. */
export async function addChecklistItem(formData: FormData): Promise<void> {
  const user = await requireCompanyUser();
  if (!can(user.role, "recordDeals")) return;
  const dealId = String(formData.get("dealId") || "");
  const label = String(formData.get("label") || "").trim();
  if (!label) return;
  const required = formData.get("required") === "on" || formData.get("required") === "true";
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, companyId: user.companyId },
    select: { id: true, _count: { select: { checklist: true } } },
  });
  if (!deal) return;
  await prisma.dealChecklistItem.create({
    data: { dealId, label: label.slice(0, 200), required, order: deal._count.checklist },
  });
  revalidatePath(`/deals/${dealId}`);
}

/** Remove a checklist item. */
export async function deleteChecklistItem(formData: FormData): Promise<void> {
  const user = await requireCompanyUser();
  if (!can(user.role, "recordDeals")) return;
  const id = String(formData.get("id") || "");
  const item = await prisma.dealChecklistItem.findFirst({
    where: { id, deal: { companyId: user.companyId } },
    select: { id: true, dealId: true },
  });
  if (!item) return;
  await prisma.dealChecklistItem.delete({ where: { id } });
  revalidatePath(`/deals/${item.dealId}`);
}
