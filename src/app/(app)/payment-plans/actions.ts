"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCompanyUser, isScopedToSelf } from "@/lib/session";
import { logActivity } from "@/lib/activity";

export type FormState = { ok?: boolean; error?: string };

const PAYMENT_TYPES = ["TOKEN", "BOOKING", "DOWN_PAYMENT", "INSTALMENT", "DEPOSIT"];

/**
 * Create an installment-plan template from the form's parallel milestone arrays
 * (label[], pct[], type[], count[], firstDueMonths[], intervalMonths[]).
 * Office-only. Percentages don't have to sum to 100 — the UI warns, but partial
 * plans (e.g. just a booking + down payment) are valid.
 */
export async function createPaymentPlan(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireCompanyUser();
  if (isScopedToSelf(user.role)) return { error: "Not allowed." };

  const name = String(formData.get("name") || "").trim();
  if (name.length < 2) return { error: "Plan name is required." };

  const labels = formData.getAll("label").map(String);
  const pcts = formData.getAll("pct").map((v) => Number(v));
  const types = formData.getAll("type").map(String);
  const counts = formData.getAll("count").map((v) => Math.max(1, Math.floor(Number(v) || 1)));
  const firsts = formData.getAll("firstDueMonths").map((v) => Math.max(0, Math.floor(Number(v) || 0)));
  const intervals = formData.getAll("intervalMonths").map((v) => Math.max(0, Math.floor(Number(v) || 1)));

  const milestones = labels
    .map((label, i) => ({
      order: i,
      label: label.trim(),
      pct: pcts[i],
      type: PAYMENT_TYPES.includes(types[i]) ? types[i] : "INSTALMENT",
      count: counts[i] ?? 1,
      firstDueMonths: firsts[i] ?? 0,
      intervalMonths: intervals[i] ?? 1,
    }))
    .filter((m) => m.label && Number.isFinite(m.pct) && m.pct > 0);

  if (milestones.length === 0) return { error: "Add at least one milestone with a label and a percentage." };

  await prisma.paymentPlanTemplate.create({
    data: {
      companyId: user.companyId,
      name,
      description: String(formData.get("description") || "").trim() || null,
      milestones: {
        create: milestones.map((m) => ({
          order: m.order,
          label: m.label,
          pct: new Prisma.Decimal(m.pct),
          type: m.type as Prisma.PaymentMilestoneCreateInput["type"],
          count: m.count,
          firstDueMonths: m.firstDueMonths,
          intervalMonths: m.intervalMonths,
        })),
      },
    },
  });

  await logActivity({
    companyId: user.companyId, userId: user.id, action: "payment_plan.created",
    entityType: "PAYMENT", entityId: null, summary: `Created payment plan "${name}"`,
  });
  revalidatePath("/payment-plans");
  return { ok: true };
}

export async function deletePaymentPlan(id: string): Promise<FormState> {
  const user = await requireCompanyUser();
  if (isScopedToSelf(user.role)) return { error: "Not allowed." };
  await prisma.paymentPlanTemplate.deleteMany({ where: { id, companyId: user.companyId } });
  revalidatePath("/payment-plans");
  return { ok: true };
}
