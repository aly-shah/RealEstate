"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

const companySchema = z.object({
  companyName: z.string().min(2, "Company name is required"),
  ownerName: z.string().min(2, "Owner name is required"),
  ownerEmail: z.string().email("Valid email required"),
  ownerPassword: z.string().min(6, "Min 6 characters"),
});

export type FormState = { error?: string; ok?: boolean };

async function ensureSuperAdmin() {
  const user = await requireUser();
  if (user.role !== "SUPER_ADMIN") throw new Error("Forbidden");
  return user;
}

export async function createCompany(_prev: FormState, formData: FormData): Promise<FormState> {
  await ensureSuperAdmin();

  const parsed = companySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email: d.ownerEmail.toLowerCase() } });
  if (existing) return { error: "Owner email already in use." };

  await prisma.company.create({
    data: {
      name: d.companyName,
      status: "ACTIVE",
      users: {
        create: {
          name: d.ownerName,
          email: d.ownerEmail.toLowerCase(),
          passwordHash: await bcrypt.hash(d.ownerPassword, 10),
          role: "OWNER",
        },
      },
      commissionRules: {
        create: { name: "Company Default 50 / 25 / 25", isDefault: true },
      },
    },
  });

  revalidatePath("/admin/companies");
  return { ok: true };
}

export async function setCompanyStatus(formData: FormData): Promise<void> {
  await ensureSuperAdmin();
  const id = String(formData.get("id"));
  const status = String(formData.get("status")) as "ACTIVE" | "SUSPENDED" | "TRIAL";
  await prisma.company.update({ where: { id }, data: { status } });
  revalidatePath("/admin/companies");
}
