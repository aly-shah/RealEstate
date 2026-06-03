import type { CompanyPlan } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Per-plan resource limits. PRO is uncapped (Infinity). Storage is tracked
 * but not yet enforced — would need a periodic scan of /uploads to be useful.
 *
 * Tweak the numbers here as the commercial offer firms up; nothing else
 * needs to change because every enforcement point reads from this single map.
 */
export const PLAN_LIMITS: Record<
  CompanyPlan,
  { users: number; properties: number; storageMB: number; label: string }
> = {
  FREE:    { users: 3,        properties: 25,       storageMB: 100,   label: "Free" },
  TRIAL:   { users: 5,        properties: 50,       storageMB: 500,   label: "Trial" },
  STARTER: { users: 10,       properties: 200,      storageMB: 1_000, label: "Starter" },
  GROWTH:  { users: 25,       properties: 1_000,    storageMB: 5_000, label: "Growth" },
  PRO:     { users: Infinity, properties: Infinity, storageMB: 50_000, label: "Pro" },
};

export interface UsageCheck {
  ok: boolean;
  used: number;
  limit: number;
  /** Friendly explanation suitable for surfacing in toasts / form errors. */
  reason?: string;
}

/**
 * Generic "is there room?" check. Returns `{ ok: false, reason }` when the
 * tenant has hit its plan cap. Callers should bail before the write — the
 * actual `prisma.x.create()` would still succeed at the DB level (no FK
 * preventing it), so this is the enforcement boundary.
 */
async function checkUsage(
  companyId: string,
  resource: "users" | "properties",
): Promise<UsageCheck> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { plan: true },
  });
  if (!company) return { ok: false, used: 0, limit: 0, reason: "Company not found." };

  const limit = PLAN_LIMITS[company.plan][resource];
  const used =
    resource === "users"
      ? await prisma.user.count({ where: { companyId } })
      : await prisma.property.count({ where: { companyId } });

  if (used >= limit) {
    const planLabel = PLAN_LIMITS[company.plan].label;
    return {
      ok: false,
      used,
      limit,
      reason: `Your ${planLabel} plan allows ${limit} ${resource}; you already have ${used}. Upgrade the plan or remove inactive ${resource}.`,
    };
  }
  return { ok: true, used, limit };
}

export const canAddUser = (companyId: string) => checkUsage(companyId, "users");
export const canAddProperty = (companyId: string) => checkUsage(companyId, "properties");

/**
 * Snapshot for the Settings → Plan usage panel. Single round-trip via parallel
 * Promise.all so the page doesn't pay three sequential round-trips.
 */
export async function planUsageSnapshot(companyId: string) {
  const [company, users, properties] = await Promise.all([
    prisma.company.findUnique({
      where: { id: companyId },
      select: { plan: true, billingStatus: true, trialEndsAt: true, renewalAt: true },
    }),
    prisma.user.count({ where: { companyId } }),
    prisma.property.count({ where: { companyId } }),
  ]);
  if (!company) return null;
  const limits = PLAN_LIMITS[company.plan];
  return {
    plan: company.plan,
    planLabel: limits.label,
    billingStatus: company.billingStatus,
    trialEndsAt: company.trialEndsAt,
    renewalAt: company.renewalAt,
    users: { used: users, limit: limits.users },
    properties: { used: properties, limit: limits.properties },
  };
}
