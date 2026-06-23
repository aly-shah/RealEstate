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

const allocateSchema = z.object({
  projectId: z.string().min(1),
  tower: z.string().min(1, "Tower is required"),
  dealerId: z.string().min(1, "Pick a dealer"),
});

/**
 * Channel allocation: assign every AVAILABLE unit in a tower to a dealer (sets
 * Property.dealerId), so it shows up in that dealer's "inventory to sell". A
 * dealerId of "__unassign__" clears the allocation. Office-only.
 */
export async function allocateTower(_prev: FormState, formData: FormData): Promise<FormState> {
  const { user, allowed } = await requireInventoryManager();
  if (!allowed) return { error: "Not allowed." };

  const parsed = allocateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Please fix the errors below.", fieldErrors: parsed.error.flatten().fieldErrors };
  const d = parsed.data;
  const tower = d.tower.trim().toUpperCase();
  const unassign = d.dealerId === "__unassign__";

  if (!unassign) {
    const dealer = await prisma.dealer.findFirst({ where: { id: d.dealerId, companyId: user.companyId }, select: { id: true } });
    if (!dealer) return { error: "Dealer not found." };
  }

  // Only AVAILABLE units — never reassign one that's reserved/sold under a booking.
  const { count } = await prisma.property.updateMany({
    where: { companyId: user.companyId, projectId: d.projectId, tower, status: "AVAILABLE" },
    data: { dealerId: unassign ? null : d.dealerId },
  });

  await logActivity({
    companyId: user.companyId, userId: user.id, action: "project.allocated",
    entityType: "PROPERTY", entityId: d.projectId,
    summary: unassign ? `Cleared dealer on ${count} unit(s) in tower ${tower}` : `Allocated ${count} unit(s) in tower ${tower} to a dealer`,
    meta: { tower, dealerId: unassign ? null : d.dealerId, count },
  });

  revalidatePath(`/projects/${d.projectId}`);
  return count === 0 ? { error: `No AVAILABLE units in tower ${tower} to allocate.` } : {};
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

interface UnitTypeForGen {
  id: string;
  name: string;
  bedrooms: number | null;
  bathrooms: number | null;
  areaValue: number | null;
  areaUnit: Prisma.PropertyCreateManyInput["areaUnit"];
  basePrice: number;
  floorRise: number;
}

/**
 * Builds the Property rows for a tower of one unit type — floors floorFrom..floorTo,
 * `unitsPerFloor` per floor, price = basePrice + (floor - 1) × floorRise. Shared by
 * the per-tower generator and the create-project wizard.
 */
function buildUnitRows(opts: {
  companyId: string;
  projectId: string;
  projectName: string;
  city: string | null;
  area: string | null;
  unitType: UnitTypeForGen;
  tower: string;
  floorFrom: number;
  floorTo: number;
  unitsPerFloor: number;
}): Prisma.PropertyCreateManyInput[] {
  const prefix = refPrefix(opts.projectName);
  const tower = opts.tower.trim().toUpperCase();
  const { unitType } = opts;
  const rows: Prisma.PropertyCreateManyInput[] = [];
  for (let f = opts.floorFrom; f <= opts.floorTo; f++) {
    for (let u = 1; u <= opts.unitsPerFloor; u++) {
      const unitNumber = `${f}${String(u).padStart(2, "0")}`;
      rows.push({
        companyId: opts.companyId,
        projectId: opts.projectId,
        unitTypeId: unitType.id,
        reference: `${prefix}-${tower}-${unitNumber}`,
        title: `${unitType.name} · ${tower}-${unitNumber}`,
        type: "APARTMENT",
        listingType: "SALE",
        status: "AVAILABLE",
        tower,
        floorNumber: f,
        unitNumber,
        bedrooms: unitType.bedrooms,
        bathrooms: unitType.bathrooms,
        coveredArea: unitType.areaValue,
        areaUnit: unitType.areaUnit,
        city: opts.city,
        area: opts.area,
        salePrice: new Prisma.Decimal(unitType.basePrice + Math.max(0, f - 1) * unitType.floorRise),
      });
    }
  }
  return rows;
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

  const tower = d.tower.trim().toUpperCase();
  const rows = buildUnitRows({
    companyId: user.companyId,
    projectId: project.id,
    projectName: project.name,
    city: project.city,
    area: project.area,
    unitType: { ...unitType, basePrice: Number(unitType.basePrice), floorRise: Number(unitType.floorRise) },
    tower,
    floorFrom: d.floorFrom,
    floorTo: d.floorTo,
    unitsPerFloor: d.unitsPerFloor,
  });

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

/* ───────────────────────────── Create-project wizard ───────────────────────── */

const AREA_UNITS = ["SQFT", "SQM", "SQYD", "MARLA", "KANAL"] as const;

const wizardSchema = z.object({
  name: z.string().min(2, "Project name is required"),
  status: z.enum(PROJECT_STATUSES).optional(),
  city: z.string().optional(),
  area: z.string().optional(),
  description: z.string().optional(),
  isOffPlan: z.boolean().optional(),
  launchDate: z.string().optional(),
  unitTypes: z.array(z.object({
    key: z.string(),
    name: z.string().min(1),
    bedrooms: z.number().int().min(0).nullable().optional(),
    bathrooms: z.number().int().min(0).nullable().optional(),
    areaValue: z.number().min(0).nullable().optional(),
    areaUnit: z.enum(AREA_UNITS).optional(),
    basePrice: z.number().min(0),
    floorRise: z.number().min(0).optional(),
  })).optional(),
  batches: z.array(z.object({
    tower: z.string().min(1),
    floorFrom: z.number().int(),
    floorTo: z.number().int(),
    unitsPerFloor: z.number().int().min(1),
    unitTypeKey: z.string().min(1),
  })).optional(),
});

export type ProjectWizardInput = z.infer<typeof wizardSchema>;
export type WizardResult = { ok: true; projectId: string } | { ok: false; error: string };

const MAX_TOTAL_UNITS = 5000;

/**
 * Create a project, its unit-type price list, and (optionally) its starting
 * inventory in one guided step — the create-project wizard. Everything happens
 * in a single transaction: the project, the unit types (each tagged with a
 * client `key`), and the generated units for each inventory batch (a batch
 * references a type by `key`). Prices use floor-rise from the type.
 */
export async function createProjectFull(input: ProjectWizardInput): Promise<WizardResult> {
  const { user, allowed } = await requireInventoryManager();
  if (!allowed) return { ok: false, error: "Not allowed." };

  const parsed = wizardSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const d = parsed.data;
  const types = d.unitTypes ?? [];
  const batches = d.batches ?? [];

  // Validate batch references + total unit count before writing anything.
  const typeByKey = new Map(types.map((t) => [t.key, t]));
  let totalUnits = 0;
  for (const b of batches) {
    if (!typeByKey.has(b.unitTypeKey)) return { ok: false, error: "An inventory row references a unit type that was removed." };
    if (b.floorTo < b.floorFrom) return { ok: false, error: `Tower ${b.tower}: top floor must be ≥ bottom floor.` };
    totalUnits += (b.floorTo - b.floorFrom + 1) * b.unitsPerFloor;
  }
  if (totalUnits > MAX_TOTAL_UNITS) return { ok: false, error: `That would create ${totalUnits} units — keep it under ${MAX_TOTAL_UNITS}.` };

  const projectId = await prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        companyId: user.companyId,
        name: d.name,
        status: d.status ?? "PLANNING",
        city: d.city || null,
        area: d.area || null,
        description: d.description || null,
        isOffPlan: !!d.isOffPlan,
        launchDate: d.launchDate ? new Date(d.launchDate) : null,
      },
      select: { id: true, name: true, city: true, area: true },
    });

    // Create unit types, mapping each client key → created row.
    const createdByKey = new Map<string, UnitTypeForGen>();
    for (const t of types) {
      const ut = await tx.unitType.create({
        data: {
          companyId: user.companyId,
          projectId: project.id,
          name: t.name,
          bedrooms: t.bedrooms ?? null,
          bathrooms: t.bathrooms ?? null,
          areaValue: t.areaValue ?? null,
          areaUnit: t.areaUnit ?? "SQFT",
          basePrice: new Prisma.Decimal(t.basePrice),
          floorRise: new Prisma.Decimal(t.floorRise ?? 0),
        },
        select: { id: true, name: true, bedrooms: true, bathrooms: true, areaValue: true, areaUnit: true, basePrice: true, floorRise: true },
      });
      createdByKey.set(t.key, { ...ut, basePrice: Number(ut.basePrice), floorRise: Number(ut.floorRise) });
    }

    // Generate inventory for each batch.
    const rows: Prisma.PropertyCreateManyInput[] = [];
    for (const b of batches) {
      const unitType = createdByKey.get(b.unitTypeKey)!;
      rows.push(...buildUnitRows({
        companyId: user.companyId,
        projectId: project.id,
        projectName: project.name,
        city: project.city,
        area: project.area,
        unitType,
        tower: b.tower,
        floorFrom: b.floorFrom,
        floorTo: b.floorTo,
        unitsPerFloor: b.unitsPerFloor,
      }));
    }
    if (rows.length) await tx.property.createMany({ data: rows, skipDuplicates: true });

    return project.id;
  });

  await logActivity({
    companyId: user.companyId, userId: user.id, action: "project.created",
    entityType: "PROPERTY", entityId: projectId,
    summary: `Created project ${d.name} (${types.length} type(s), ${totalUnits} unit(s))`,
    meta: { unitTypes: types.length, units: totalUnits },
  });

  revalidatePath("/projects");
  return { ok: true, projectId };
}
