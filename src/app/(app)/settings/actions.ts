"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireCompanyUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { logActivity } from "@/lib/activity";

const userSchema = z.object({
  name: z.string().min(2, "Name is required"),
  email: z.string().email("Valid email required"),
  password: z.string().min(6, "Min 6 characters"),
  role: z.enum(["ADMIN", "AGENT", "DEALER"]),
  phone: z.string().optional(),
});

export type FormState = { error?: string; ok?: boolean };

export async function createUser(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireCompanyUser();
  if (!can(user.role, "manageUsers")) return { error: "Not allowed." };

  const parsed = userSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email: d.email.toLowerCase() } });
  if (existing) return { error: "That email is already in use." };

  const created = await prisma.user.create({
    data: {
      companyId: user.companyId,
      name: d.name,
      email: d.email.toLowerCase(),
      passwordHash: await bcrypt.hash(d.password, 10),
      role: d.role,
      phone: d.phone || null,
    },
  });

  // A dealer login also gets a dealer profile so inventory can link to them.
  if (d.role === "DEALER") {
    await prisma.dealer.create({
      data: { companyId: user.companyId, userId: created.id, name: d.name, contact: d.phone || null },
    });
  }

  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: "user.created",
    entityType: "USER",
    entityId: created.id,
    summary: `Added ${d.role.toLowerCase()} ${d.name}`,
  });

  revalidatePath("/settings");
  return { ok: true };
}

const ruleSchema = z.object({
  mainAgentPct: z.coerce.number().min(0).max(100),
  companyPct: z.coerce.number().min(0).max(100),
  otherAgentPct: z.coerce.number().min(0).max(100),
  dealerPct: z.coerce.number().min(0).max(100),
  noOtherFallback: z.enum(["MAIN", "COMPANY"]),
});

export async function updateCommissionRule(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireCompanyUser();
  if (!can(user.role, "setCommissionRules")) return { error: "Not allowed." };

  const parsed = ruleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const sum = d.mainAgentPct + d.companyPct + d.otherAgentPct + d.dealerPct;
  if (Math.round(sum) !== 100) return { error: `Percentages must total 100% (currently ${sum}%).` };

  const existing = await prisma.commissionRule.findFirst({ where: { companyId: user.companyId, isDefault: true } });
  const data = {
    mainAgentPct: new Prisma.Decimal(d.mainAgentPct),
    companyPct: new Prisma.Decimal(d.companyPct),
    otherAgentPct: new Prisma.Decimal(d.otherAgentPct),
    dealerPct: new Prisma.Decimal(d.dealerPct),
    noOtherFallback: d.noOtherFallback,
  };

  if (existing) {
    await prisma.commissionRule.update({ where: { id: existing.id }, data });
  } else {
    await prisma.commissionRule.create({
      data: { companyId: user.companyId, name: "Company Default", isDefault: true, ...data },
    });
  }

  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: "commission_rule.updated",
    entityType: "COMMISSION_RULE",
    summary: `Updated default split → ${d.mainAgentPct}/${d.companyPct}/${d.otherAgentPct}/${d.dealerPct}`,
  });

  revalidatePath("/settings");
  return { ok: true };
}
