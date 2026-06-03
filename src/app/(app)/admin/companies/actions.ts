"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { derivePrefix } from "@/lib/refs";

const companySchema = z.object({
  companyName: z.string().min(2, "Company name is required"),
  // Slug auto-generated from the name when omitted. Lowercase + alnum + dashes.
  slug: z.string().regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers and dashes only").min(2).max(40).optional().or(z.literal("")),
  refPrefix: z.string().regex(/^[A-Z0-9]{2,6}$/, "2–6 uppercase letters / numbers").optional().or(z.literal("")),
  plan: z.enum(["FREE", "TRIAL", "STARTER", "GROWTH", "PRO"]).default("STARTER"),
  trialEndsAt: z.string().optional(),
  timezone: z.string().max(60).optional(),
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

/** Defaults a slug from the company name when the operator leaves it blank. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export async function createCompany(_prev: FormState, formData: FormData): Promise<FormState> {
  await ensureSuperAdmin();

  const parsed = companySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  // Slug + refPrefix: take operator value when provided, otherwise derive.
  // Empty strings get coerced to derived values rather than null so every new
  // tenant has both (existing tenants pre-Phase-8 can keep their NULL slug).
  const slug = (d.slug && d.slug.length > 0 ? d.slug : slugify(d.companyName)) || null;
  const refPrefix = (d.refPrefix && d.refPrefix.length > 0 ? d.refPrefix : derivePrefix(d.companyName)) || null;

  // Pre-flight uniqueness checks so we can give a friendly error rather than
  // surface a raw P2002.
  if (slug) {
    const slugTaken = await prisma.company.findUnique({ where: { slug }, select: { id: true } });
    if (slugTaken) return { error: `Slug "${slug}" is already in use.` };
  }
  const existing = await prisma.user.findUnique({ where: { email: d.ownerEmail.toLowerCase() } });
  if (existing) return { error: "Owner email already in use." };

  // Trial-status logic: TRIAL plan → billingStatus=TRIAL + 30-day default
  // trialEndsAt (operator may override via the form). Everything else → ACTIVE.
  const trialEndsAt =
    d.trialEndsAt && /^\d{4}-\d{2}-\d{2}$/.test(d.trialEndsAt)
      ? new Date(`${d.trialEndsAt}T23:59:59.999`)
      : d.plan === "TRIAL"
        ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        : null;
  const billingStatus = d.plan === "TRIAL" ? "TRIAL" : "ACTIVE";

  await prisma.company.create({
    data: {
      name: d.companyName,
      slug,
      refPrefix,
      plan: d.plan,
      status: "ACTIVE",
      billingStatus,
      trialEndsAt,
      timezone: d.timezone?.trim() || null,
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
