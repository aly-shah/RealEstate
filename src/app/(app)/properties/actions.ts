"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCompanyUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { propertyScope } from "@/lib/scope";
import { logActivity } from "@/lib/activity";
import { humanize } from "@/lib/format";
import { nextPropertyReference } from "@/lib/refs";
import { setFlash } from "@/lib/flash";
import { canAddProperty } from "@/lib/plans";
import { newShareSlug } from "@/lib/share";

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

export async function createProperty(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireCompanyUser();
  if (!can(user.role, "manageProperties")) return { error: "Not allowed." };

  const parsed = propertySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: "Please fix the errors below.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const d = parsed.data;

  // Phase 8: hard-stop at the per-plan property cap before we burn a reference.
  const usage = await canAddProperty(user.companyId);
  if (!usage.ok) return { error: usage.reason ?? "Property limit reached for your current plan." };

  // Allocate reference + create with retry — `nextPropertyReference` may collide
  // with a concurrent create (the only race we expect); the unique index on
  // (companyId, reference) protects us, so we just bump and try again.
  const dataBase = {
    companyId: user.companyId,
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
    agents: user.role === "AGENT" ? { create: [{ agentId: user.id }] } : undefined,
  };

  let property: Awaited<ReturnType<typeof prisma.property.create>> | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      property = await prisma.property.create({
        data: { ...dataBase, reference: await nextPropertyReference(user.companyId) },
      });
      break;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
      throw e;
    }
  }
  if (!property) return { error: "Could not allocate a property reference. Try again." };

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

/** OWNER/ADMIN only — attaches an agent to a property. Composite PK guards
 *  against duplicate assignment; the catch swallows the duplicate quietly so
 *  re-submitting the same agent twice is a no-op rather than an error. */
export async function assignPropertyAgent(formData: FormData): Promise<void> {
  const user = await requireCompanyUser();
  if (user.role !== "OWNER" && user.role !== "ADMIN") return;

  const propertyId = String(formData.get("propertyId"));
  const agentId = String(formData.get("agentId") || "");
  if (!propertyId || !agentId) return;

  const [property, agent] = await Promise.all([
    prisma.property.findFirst({ where: { id: propertyId, companyId: user.companyId } }),
    prisma.user.findFirst({ where: { id: agentId, companyId: user.companyId, role: "AGENT", status: "ACTIVE" } }),
  ]);
  if (!property || !agent) return;

  try {
    await prisma.propertyAgent.create({ data: { propertyId, agentId } });
    await logActivity({
      companyId: user.companyId,
      userId: user.id,
      action: "property.agent_added",
      entityType: "PROPERTY",
      entityId: propertyId,
      summary: `Assigned ${agent.name} to ${property.reference}`,
    });
  } catch (e) {
    // P2002 → already assigned; ignore. Anything else, re-raise.
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
  }
  revalidatePath(`/properties/${propertyId}`);
}

/** OWNER/ADMIN only — removes an agent from a property. */
export async function unassignPropertyAgent(formData: FormData): Promise<void> {
  const user = await requireCompanyUser();
  if (user.role !== "OWNER" && user.role !== "ADMIN") return;

  const propertyId = String(formData.get("propertyId"));
  const agentId = String(formData.get("agentId") || "");
  if (!propertyId || !agentId) return;

  const property = await prisma.property.findFirst({
    where: { id: propertyId, companyId: user.companyId },
    select: { id: true, reference: true },
  });
  if (!property) return;

  // Find the agent's name for the activity summary before deleting.
  const agent = await prisma.user.findFirst({
    where: { id: agentId, companyId: user.companyId },
    select: { name: true },
  });

  await prisma.propertyAgent
    .delete({ where: { propertyId_agentId: { propertyId, agentId } } })
    .catch(() => null);

  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: "property.agent_removed",
    entityType: "PROPERTY",
    entityId: propertyId,
    summary: `Removed ${agent?.name ?? "agent"} from ${property.reference}`,
  });
  revalidatePath(`/properties/${propertyId}`);
}

/**
 * Turns the public client-facing share link on or off. Anyone who can see the
 * property (office, or the assigned agent) can share it — scoped via
 * propertyScope so agents can't toggle a listing that isn't theirs. The slug is
 * minted once and reused, so toggling off then on again keeps the same URL;
 * `sharedById` records who shared it (shown to the client as the contact).
 */
export async function setPropertyShare(formData: FormData): Promise<void> {
  const user = await requireCompanyUser();
  const id = String(formData.get("id"));
  const enabled = String(formData.get("enabled")) === "true";

  const scope = await propertyScope(user);
  const property = await prisma.property.findFirst({
    where: { id, ...scope },
    select: { id: true, reference: true, shareSlug: true, shareEnabled: true },
  });
  if (!property) return;
  if (property.shareEnabled === enabled && property.shareSlug) return; // no-op

  await prisma.property.update({
    where: { id },
    data: {
      shareEnabled: enabled,
      shareSlug: property.shareSlug ?? newShareSlug(),
      sharedById: enabled ? user.id : property.shareEnabled ? undefined : null,
    },
  });
  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: enabled ? "property.shared" : "property.unshared",
    entityType: "PROPERTY",
    entityId: id,
    summary: `${enabled ? "Enabled" : "Disabled"} client share link for ${property.reference}`,
  });
  // Revalidate both surfaces so the toggle reflects whether sharing was done
  // from the detail page or the quick-share drawer on the list.
  revalidatePath(`/properties/${id}`);
  revalidatePath("/properties");
}

export async function updatePropertyStatus(formData: FormData): Promise<void> {
  const user = await requireCompanyUser();
  if (!can(user.role, "manageProperties")) return;

  const id = String(formData.get("id"));
  const status = String(formData.get("status")) as Prisma.PropertyUpdateInput["status"];

  const property = await prisma.property.findFirst({ where: { id, companyId: user.companyId } });
  if (!property) return;
  if (property.status === status) return; // no-op; avoids log noise

  await prisma.property.update({ where: { id }, data: { status } });
  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: "property.status",
    entityType: "PROPERTY",
    entityId: id,
    summary: `Status → ${humanize(String(status))} for ${property.reference}`,
    meta: { from: property.status, to: String(status) },
  });
  await setFlash({ tone: "ok", message: `${property.reference}: status → ${humanize(String(status))}.` });
  revalidatePath(`/properties/${id}`);
  revalidatePath("/properties");
}
