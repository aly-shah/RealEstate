"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCompanyUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { logActivity } from "@/lib/activity";
import { humanize } from "@/lib/format";

const propertySchema = z.object({
  title: z.string().min(2, "Title is required"),
  type: z.enum(["RESIDENTIAL", "COMMERCIAL", "PLOT", "APARTMENT", "VILLA", "SHOP", "OFFICE"]),
  listingType: z.enum(["SALE", "RENT", "BOTH"]),
  status: z.enum(["AVAILABLE", "RESERVED", "UNDER_NEGOTIATION", "RENTED", "SOLD", "INACTIVE", "PENDING_VERIFICATION"]),
  city: z.string().optional(),
  area: z.string().optional(),
  address: z.string().optional(),
  description: z.string().optional(),
  salePrice: z.coerce.number().nonnegative().optional(),
  monthlyRent: z.coerce.number().nonnegative().optional(),
  deposit: z.coerce.number().nonnegative().optional(),
  bedrooms: z.coerce.number().int().nonnegative().optional(),
  bathrooms: z.coerce.number().int().nonnegative().optional(),
  coveredArea: z.coerce.number().nonnegative().optional(),
  dealerId: z.string().optional(),
  ownerName: z.string().optional(),
  ownerPhone: z.string().optional(),
});

export type FormState = { error?: string; ok?: boolean; fieldErrors?: Record<string, string[]> };

function num(v?: number) {
  return v === undefined || Number.isNaN(v) ? null : new Prisma.Decimal(v);
}

async function nextReference(companyId: string): Promise<string> {
  const count = await prisma.property.count({ where: { companyId } });
  return `SKY-${String(count + 1).padStart(4, "0")}`;
}

export async function createProperty(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireCompanyUser();
  if (!can(user.role, "manageProperties")) return { error: "Not allowed." };

  const parsed = propertySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: "Please fix the errors below.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const d = parsed.data;

  const property = await prisma.property.create({
    data: {
      companyId: user.companyId,
      reference: await nextReference(user.companyId),
      title: d.title,
      type: d.type,
      listingType: d.listingType,
      status: d.status,
      city: d.city || null,
      area: d.area || null,
      address: d.address || null,
      description: d.description || null,
      salePrice: num(d.salePrice),
      monthlyRent: num(d.monthlyRent),
      deposit: num(d.deposit),
      bedrooms: d.bedrooms ?? null,
      bathrooms: d.bathrooms ?? null,
      coveredArea: d.coveredArea ?? null,
      dealerId: d.dealerId || null,
      ownerName: d.ownerName || null,
      ownerPhone: d.ownerPhone || null,
      // creating agents auto-assign themselves
      agents: user.role === "AGENT" ? { create: [{ agentId: user.id }] } : undefined,
    },
  });

  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: "property.created",
    entityType: "PROPERTY",
    entityId: property.id,
    summary: `Added property ${property.reference} — ${property.title}`,
  });

  revalidatePath("/properties");
  redirect(`/properties/${property.id}`);
}

const mediaSchema = z.object({
  propertyId: z.string().min(1),
  url: z.string().min(1, "Upload a file first"),
  kind: z.enum(["PHOTO", "VIDEO", "FLOOR_PLAN", "BROCHURE"]),
  caption: z.string().optional(),
});

export async function addPropertyMedia(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireCompanyUser();
  if (!can(user.role, "manageProperties")) return { error: "Not allowed." };

  const parsed = mediaSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const property = await prisma.property.findFirst({ where: { id: d.propertyId, companyId: user.companyId } });
  if (!property) return { error: "Property not found." };

  await prisma.propertyMedia.create({
    data: { propertyId: d.propertyId, url: d.url, kind: d.kind, caption: d.caption || null },
  });
  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: "property.media_added",
    entityType: "PROPERTY",
    entityId: d.propertyId,
    summary: `Added ${humanize(d.kind).toLowerCase()} to ${property.reference}`,
  });

  revalidatePath(`/properties/${d.propertyId}`);
  return { ok: true };
}

export async function deletePropertyMedia(formData: FormData): Promise<void> {
  const user = await requireCompanyUser();
  if (!can(user.role, "manageProperties")) return;

  const id = String(formData.get("id"));
  const media = await prisma.propertyMedia.findFirst({
    where: { id, property: { companyId: user.companyId } },
    select: { id: true, propertyId: true },
  });
  if (!media) return;

  await prisma.propertyMedia.delete({ where: { id } });
  revalidatePath(`/properties/${media.propertyId}`);
}

export async function updatePropertyStatus(formData: FormData): Promise<void> {
  const user = await requireCompanyUser();
  if (!can(user.role, "manageProperties")) return;

  const id = String(formData.get("id"));
  const status = String(formData.get("status")) as Prisma.PropertyUpdateInput["status"];

  const property = await prisma.property.findFirst({ where: { id, companyId: user.companyId } });
  if (!property) return;

  await prisma.property.update({ where: { id }, data: { status } });
  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: "property.status",
    entityType: "PROPERTY",
    entityId: id,
    summary: `Status → ${humanize(String(status))} for ${property.reference}`,
  });
  revalidatePath(`/properties/${id}`);
  revalidatePath("/properties");
}
