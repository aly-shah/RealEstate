"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCompanyUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { logActivity } from "@/lib/activity";

const docSchema = z.object({
  name: z.string().min(2, "Name is required"),
  type: z.enum([
    "CNIC_PASSPORT", "PROPERTY_DOCUMENT", "OWNERSHIP_DOCUMENT", "SALE_AGREEMENT",
    "RENTAL_AGREEMENT", "PAYMENT_RECEIPT", "DEALER_DOCUMENT", "CLIENT_DOCUMENT", "OTHER",
  ]),
  url: z.string().min(1, "A file reference/URL is required"),
  expiryDate: z.string().optional(),
  propertyId: z.string().optional(),
  dealId: z.string().optional(),
});

export type FormState = { error?: string; ok?: boolean };

export async function uploadDocument(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireCompanyUser();
  if (!can(user.role, "manageDocuments")) return { error: "Not allowed." };

  const parsed = docSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const doc = await prisma.document.create({
    data: {
      companyId: user.companyId,
      name: d.name,
      type: d.type,
      url: d.url,
      uploadedById: user.id,
      expiryDate: d.expiryDate ? new Date(d.expiryDate) : null,
      propertyId: d.propertyId || null,
      dealId: d.dealId || null,
    },
  });

  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: "document.uploaded",
    entityType: "DOCUMENT",
    entityId: doc.id,
    summary: `Uploaded document: ${doc.name}`,
  });

  revalidatePath("/documents");
  return { ok: true };
}

export async function verifyDocument(formData: FormData): Promise<void> {
  const user = await requireCompanyUser();
  if (!can(user.role, "assignLeadsCalendars")) return;

  const id = String(formData.get("id"));
  const status = String(formData.get("status")) as Prisma.DocumentUpdateInput["verification"];

  const doc = await prisma.document.findFirst({ where: { id, companyId: user.companyId } });
  if (!doc) return;

  await prisma.document.update({
    where: { id },
    data: { verification: status, verifiedById: user.id },
  });
  revalidatePath("/documents");
}
