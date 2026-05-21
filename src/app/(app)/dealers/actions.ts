"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCompanyUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { logActivity } from "@/lib/activity";

const dealerSchema = z.object({
  name: z.string().min(2, "Name is required"),
  contact: z.string().optional(),
  companyName: z.string().optional(),
  areaOfOperation: z.string().optional(),
  defaultSharePct: z.coerce.number().min(0).max(100).optional(),
  notes: z.string().optional(),
});

export type FormState = { error?: string; fieldErrors?: Record<string, string[]> };

export async function createDealer(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireCompanyUser();
  if (!can(user.role, "manageUsers")) return { error: "Not allowed." };

  const parsed = dealerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: "Please fix the errors below.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const d = parsed.data;

  const dealer = await prisma.dealer.create({
    data: {
      companyId: user.companyId,
      name: d.name,
      contact: d.contact || null,
      companyName: d.companyName || null,
      areaOfOperation: d.areaOfOperation || null,
      defaultSharePct: new Prisma.Decimal(d.defaultSharePct ?? 0),
      notes: d.notes || null,
    },
  });

  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: "dealer.created",
    entityType: "DEALER",
    entityId: dealer.id,
    summary: `Added dealer ${dealer.name}`,
  });

  revalidatePath("/dealers");
  redirect(`/dealers/${dealer.id}`);
}
