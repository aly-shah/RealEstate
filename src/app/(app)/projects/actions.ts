"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCompanyUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { logActivity } from "@/lib/activity";

export type FormState = { error?: string; fieldErrors?: Record<string, string[]> };

/** Office-only gate for managing builder inventory (create project, price list, generate units). */
async function requireInventoryManager() {
  const user = await requireCompanyUser();
  if (!can(user.role, "viewCompanyReports")) return { user, allowed: false as const };
  return { user, allowed: true as const };
}

const projectSchema = z.object({
  name: z.string().min(2, "Project name is required"),
  city: z.string().optional(),
  area: z.string().optional(),
  description: z.string().optional(),
  isOffPlan: z.coerce.boolean().optional(),
});

export async function createProject(_prev: FormState, formData: FormData): Promise<FormState> {
  const { user, allowed } = await requireInventoryManager();
  if (!allowed) return { error: "Not allowed." };

  const parsed = projectSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: "Please fix the errors below.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const d = parsed.data;

  const project = await prisma.project.create({
    data: {
      companyId: user.companyId,
      name: d.name,
      city: d.city || null,
      area: d.area || null,
      description: d.description || null,
      isOffPlan: !!d.isOffPlan,
    },
  });

  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: "project.created",
    entityType: "PROPERTY",
    entityId: project.id,
    summary: `Created project ${project.name}`,
  });

  revalidatePath("/projects");
  redirect(`/projects/${project.id}`);
}

const PROJECT_STATUSES = ["PLANNING", "PRE_LAUNCH", "SELLING", "SOLD_OUT", "COMPLETED", "ON_HOLD"] as const;

export async function updateProjectStatus(projectId: string, status: string): Promise<FormState> {
  const { user, allowed } = await requireInventoryManager();
  if (!allowed) return { error: "Not allowed." };
  if (!PROJECT_STATUSES.includes(status as (typeof PROJECT_STATUSES)[number])) return { error: "Invalid status." };

  const { count } = await prisma.project.updateMany({
    where: { id: projectId, companyId: user.companyId },
    data: { status: status as (typeof PROJECT_STATUSES)[number] },
  });
  if (count === 0) return { error: "Project not found." };

  revalidatePath(`/projects/${projectId}`);
  return {};
}

const unitTypeSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1, "Type name is required"),
  bedrooms: z.coerce.number().int().min(0).optional(),
  bathrooms: z.coerce.number().int().min(0).optional(),
  areaValue: z.coerce.number().min(0).optional(),
  areaUnit: z.enum(["SQFT", "SQM", "SQYD", "MARLA", "KANAL"]).optional(),
  basePrice: z.coerce.number().min(0, "Base price must be ≥ 0"),
  floorRise: z.coerce.number().min(0).optional(),
});

export async function addUnitType(_prev: FormState, formData: FormData): Promise<FormState> {
  const { user, allowed } = await requireInventoryManager();
  if (!allowed) return { error: "Not allowed." };

  const parsed = unitTypeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: "Please fix the errors below.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const d = parsed.data;

  // Confirm the project belongs to this tenant before attaching a type to it.
  const project = await prisma.project.findFirst({ where: { id: d.projectId, companyId: user.companyId }, select: { id: true } });
  if (!project) return { error: "Project not found." };

  await prisma.unitType.create({
    data: {
      companyId: user.companyId,
      projectId: d.projectId,
      name: d.name,
      bedrooms: d.bedrooms ?? null,
      bathrooms: d.bathrooms ?? null,
      areaValue: d.areaValue ?? null,
      areaUnit: d.areaUnit ?? "SQFT",
      basePrice: new Prisma.Decimal(d.basePrice),
      floorRise: new Prisma.Decimal(d.floorRise ?? 0),
    },
  });

  revalidatePath(`/projects/${d.projectId}`);
  return {};
}

const MAX_UNITS_PER_RUN = 2000;

const generateSchema = z.object({
  projectId: z.string().min(1),
  unitTypeId: z.string().min(1, "Pick a unit type"),
  tower: z.string().min(1, "Tower/block is required"),
  floorFrom: z.coerce.number().int(),
  floorTo: z.coerce.number().int(),
  unitsPerFloor: z.coerce.number().int().min(1, "At least 1 unit per floor"),
});

/** Sanitise a project name into a short reference prefix (e.g. "Skyline Towers" → "SKY"). */
function refPrefix(name: string): string {
  const alnum = name.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return (alnum.slice(0, 3) || "PRJ");
}

/**
 * Bulk-generates AVAILABLE units for a tower: floors floorFrom..floorTo,
 * `unitsPerFloor` per floor, all of one unit type. Each unit's price is
 * basePrice + (floorNumber - 1) * floorRise (floor-rise pricing). References are
 * unique per tenant; re-running with overlapping ranges skips existing units.
 */
export async function generateUnits(_prev: FormState, formData: FormData): Promise<FormState> {
  const { user, allowed } = await requireInventoryManager();
  if (!allowed) return { error: "Not allowed." };

  const parsed = generateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: "Please fix the errors below.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const d = parsed.data;
  if (d.floorTo < d.floorFrom) return { error: "Top floor must be ≥ bottom floor." };

  const total = (d.floorTo - d.floorFrom + 1) * d.unitsPerFloor;
  if (total > MAX_UNITS_PER_RUN) return { error: `That would create ${total} units — keep it under ${MAX_UNITS_PER_RUN} per run.` };

  const [project, unitType] = await Promise.all([
    prisma.project.findFirst({ where: { id: d.projectId, companyId: user.companyId }, select: { id: true, name: true, city: true, area: true } }),
    prisma.unitType.findFirst({ where: { id: d.unitTypeId, companyId: user.companyId, projectId: d.projectId }, select: { id: true, name: true, bedrooms: true, bathrooms: true, areaValue: true, areaUnit: true, basePrice: true, floorRise: true } }),
  ]);
  if (!project) return { error: "Project not found." };
  if (!unitType) return { error: "Unit type not found." };

  const prefix = refPrefix(project.name);
  const tower = d.tower.trim().toUpperCase();
  const base = Number(unitType.basePrice);
  const rise = Number(unitType.floorRise);

  const rows: Prisma.PropertyCreateManyInput[] = [];
  for (let f = d.floorFrom; f <= d.floorTo; f++) {
    for (let u = 1; u <= d.unitsPerFloor; u++) {
      const unitNumber = `${f}${String(u).padStart(2, "0")}`;
      rows.push({
        companyId: user.companyId,
        projectId: project.id,
        unitTypeId: unitType.id,
        reference: `${prefix}-${tower}-${unitNumber}`,
        title: `${unitType.name} · ${tower}-${unitNumber}`,
        type: "APARTMENT",
        listingType: "SALE",
        status: "AVAILABLE",
        tower,
        floorNumber: f,
        unitNumber,
        bedrooms: unitType.bedrooms ?? null,
        bathrooms: unitType.bathrooms ?? null,
        coveredArea: unitType.areaValue ?? null,
        areaUnit: unitType.areaUnit,
        city: project.city,
        area: project.area,
        salePrice: new Prisma.Decimal(base + Math.max(0, f - 1) * rise),
      });
    }
  }

  // skipDuplicates: re-running an overlapping range won't error on the unique
  // (companyId, reference) — it just creates the genuinely-new units.
  const { count } = await prisma.property.createMany({ data: rows, skipDuplicates: true });

  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: "project.units_generated",
    entityType: "PROPERTY",
    entityId: project.id,
    summary: `Generated ${count} unit(s) in ${project.name} — ${tower}, floors ${d.floorFrom}–${d.floorTo}`,
    meta: { count, tower, floorFrom: d.floorFrom, floorTo: d.floorTo, unitType: unitType.name },
  });

  revalidatePath(`/projects/${d.projectId}`);
  return count === total ? {} : { error: count === 0 ? "Those units already exist." : `Created ${count} new unit(s); the rest already existed.` };
}
