"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCompanyUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { logActivity } from "@/lib/activity";
import { generateProjectCopy } from "@/lib/ai/handlers/project-copy";

export type FormState = { error?: string; fieldErrors?: Record<string, string[]> };

// Project-level facilities/amenities allow-list (mirrors the wizard's checkboxes).
// NOT exported: a "use server" file may only export async functions, so a value
// export here breaks module evaluation for every action in the file.
const PROJECT_AMENITIES = [
  "Swimming Pool", "Gym", "Parking", "Garage", "Shops / Retail", "Lift / Elevator",
  "Backup Generator", "Security / Guards", "CCTV", "Mosque", "Community Park",
  "Kids Play Area", "Clubhouse", "Rooftop Terrace", "Standby Power", "Water Filtration",
];
const AMENITY_SET = new Set(PROJECT_AMENITIES);

// Floors / beds / baths / units are conceptually integers, but a number input
// can hand us a stray decimal — round rather than hard-fail the whole form.
const roundInt = (n: number) => Math.round(n);

// FormData sends blank optional number fields as "" — coerce those to undefined
// so an empty box doesn't become 0 (e.g. an empty placement floor).
const emptyToUndef = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

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

const updateProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(2, "Project name is required"),
  status: z.enum(PROJECT_STATUSES).optional(),
  city: z.string().optional(),
  area: z.string().optional(),
  address: z.string().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  totalFloors: z.number().min(0).transform(roundInt).nullable().optional(),
  parkingFloors: z.number().min(0).transform(roundInt).nullable().optional(),
  description: z.string().optional(),
  isOffPlan: z.boolean().optional(),
  launchDate: z.string().optional(),
  completionDate: z.string().optional(),
  amenities: z.array(z.string()).optional(),
});

export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

/** Edit a project's core attributes — details, map location, amenities, dates,
 *  description. Office-only; tenant-scoped. Unit types / inventory are edited via
 *  their own controls on the project page. */
export async function updateProject(input: UpdateProjectInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const { user, allowed } = await requireInventoryManager();
  if (!allowed) return { ok: false, error: "Not allowed." };

  const parsed = updateProjectSchema.safeParse(input);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return { ok: false, error: i ? `${i.path.join(".") || "Form"}: ${i.message}` : "Please check the form." };
  }
  const d = parsed.data;

  const { count } = await prisma.project.updateMany({
    where: { id: d.id, companyId: user.companyId },
    data: {
      name: d.name,
      status: d.status,
      city: d.city || null,
      area: d.area || null,
      address: d.address || null,
      latitude: d.latitude ?? null,
      longitude: d.longitude ?? null,
      totalFloors: d.totalFloors ?? null,
      parkingFloors: d.parkingFloors ?? null,
      description: d.description || null,
      isOffPlan: !!d.isOffPlan,
      launchDate: d.launchDate ? new Date(d.launchDate) : null,
      completionDate: d.completionDate ? new Date(d.completionDate) : null,
      amenities: (d.amenities ?? []).filter((a) => AMENITY_SET.has(a)),
    },
  });
  if (count === 0) return { ok: false, error: "Project not found." };

  await logActivity({
    companyId: user.companyId, userId: user.id, action: "project.updated",
    entityType: "PROPERTY", entityId: d.id, summary: `Updated project ${d.name}`,
  });
  revalidatePath("/projects");
  revalidatePath(`/projects/${d.id}`);
  return { ok: true };
}

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
  bedrooms: z.preprocess(emptyToUndef, z.coerce.number().min(0).transform(roundInt).optional()),
  bathrooms: z.preprocess(emptyToUndef, z.coerce.number().min(0).transform(roundInt).optional()),
  areaValue: z.preprocess(emptyToUndef, z.coerce.number().min(0).optional()),
  areaUnit: z.enum(["SQFT", "SQM", "SQYD", "MARLA", "KANAL"]).optional(),
  basePrice: z.coerce.number().min(0, "Base price must be ≥ 0"),
  floorRise: z.preprocess(emptyToUndef, z.coerce.number().min(0).optional()),
  // Optional placement — when all are set, the type's units are generated too.
  tower: z.string().optional(),
  floorFrom: z.preprocess(emptyToUndef, z.coerce.number().transform(roundInt).optional()),
  floorTo: z.preprocess(emptyToUndef, z.coerce.number().transform(roundInt).optional()),
  unitsPerFloor: z.preprocess(emptyToUndef, z.coerce.number().min(1).transform(roundInt).optional()),
});

/**
 * Add a unit type to a project. If the layout's placement (floors + units per
 * floor) is supplied, its inventory is generated in the same transaction — so
 * "add a unit" is one integrated step instead of add-type-then-generate.
 */
export async function addUnitType(_prev: FormState, formData: FormData): Promise<FormState> {
  const { user, allowed } = await requireInventoryManager();
  if (!allowed) return { error: "Not allowed." };

  const parsed = unitTypeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: "Please fix the errors below.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const d = parsed.data;

  // Confirm the project belongs to this tenant before attaching a type to it.
  const project = await prisma.project.findFirst({ where: { id: d.projectId, companyId: user.companyId }, select: { id: true, name: true, city: true, area: true } });
  if (!project) return { error: "Project not found." };

  const hasPlacement = d.floorFrom != null && d.floorTo != null && d.unitsPerFloor != null && d.unitsPerFloor >= 1;
  if (hasPlacement) {
    if (d.floorTo! < d.floorFrom!) return { error: "Top floor must be ≥ bottom floor." };
    const total = (d.floorTo! - d.floorFrom! + 1) * d.unitsPerFloor!;
    if (total > MAX_UNITS_PER_RUN) return { error: `That would create ${total} units — keep it under ${MAX_UNITS_PER_RUN}.` };
  }

  await prisma.$transaction(async (tx) => {
    const ut = await tx.unitType.create({
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
        tower: hasPlacement ? (d.tower?.trim().toUpperCase() || "A") : null,
        floorFrom: d.floorFrom ?? null,
        floorTo: d.floorTo ?? null,
        unitsPerFloor: d.unitsPerFloor ?? null,
      },
      select: { id: true, name: true, bedrooms: true, bathrooms: true, areaValue: true, areaUnit: true, basePrice: true, floorRise: true },
    });
    if (hasPlacement) {
      const rows = buildUnitRows({
        companyId: user.companyId,
        projectId: d.projectId,
        projectName: project.name,
        city: project.city,
        area: project.area,
        unitType: { ...ut, basePrice: Number(ut.basePrice), floorRise: Number(ut.floorRise) },
        tower: d.tower?.trim() || "A",
        floorFrom: d.floorFrom!,
        floorTo: d.floorTo!,
        unitsPerFloor: d.unitsPerFloor!,
      });
      await tx.property.createMany({ data: rows, skipDuplicates: true });
    }
  });

  await logActivity({
    companyId: user.companyId, userId: user.id, action: hasPlacement ? "project.units_generated" : "project.unit_type_added",
    entityType: "PROPERTY", entityId: d.projectId,
    summary: hasPlacement
      ? `Added ${d.name} + ${(d.floorTo! - d.floorFrom! + 1) * d.unitsPerFloor!} unit(s)`
      : `Added unit type ${d.name}`,
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
  floorFrom: z.coerce.number().transform(roundInt),
  floorTo: z.coerce.number().transform(roundInt),
  unitsPerFloor: z.coerce.number().min(1, "At least 1 unit per floor").transform(roundInt),
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
        // Base price applies on this type's lowest floor; +floorRise per floor up.
        salePrice: new Prisma.Decimal(unitType.basePrice + Math.max(0, f - opts.floorFrom) * unitType.floorRise),
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

/* ───────────────────────────── Edit / delete a single unit ─────────────────── */

const UNIT_STATUSES = ["AVAILABLE", "RESERVED", "SOLD", "INACTIVE"] as const;

const updateUnitSchema = z.object({
  unitId: z.string().min(1),
  salePrice: z.coerce.number().min(0),
  status: z.enum(UNIT_STATUSES),
});

export type UnitResult = { ok: true } | { ok: false; error: string };

/** Quick-edit a unit's price + status from the project inventory table. */
export async function updateUnit(input: z.infer<typeof updateUnitSchema>): Promise<UnitResult> {
  const { user, allowed } = await requireInventoryManager();
  if (!allowed) return { ok: false, error: "Not allowed." };

  const parsed = updateUnitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const unit = await prisma.property.findFirst({ where: { id: d.unitId, companyId: user.companyId, projectId: { not: null } }, select: { id: true, projectId: true } });
  if (!unit) return { ok: false, error: "Unit not found." };

  await prisma.property.update({
    where: { id: unit.id },
    data: { salePrice: new Prisma.Decimal(d.salePrice), status: d.status, version: { increment: 1 } },
  });
  await logActivity({ companyId: user.companyId, userId: user.id, action: "unit.updated", entityType: "PROPERTY", entityId: unit.id, summary: `Updated unit` });
  if (unit.projectId) revalidatePath(`/projects/${unit.projectId}`);
  return { ok: true };
}

/** Delete a unit. Only AVAILABLE units with no deal can be removed (a sold/
 *  reserved unit is part of a transaction and must be kept). */
export async function deleteUnit(unitId: string): Promise<UnitResult> {
  const { user, allowed } = await requireInventoryManager();
  if (!allowed) return { ok: false, error: "Not allowed." };

  const unit = await prisma.property.findFirst({
    where: { id: unitId, companyId: user.companyId, projectId: { not: null } },
    select: { id: true, projectId: true, reference: true, status: true, _count: { select: { deals: true } } },
  });
  if (!unit) return { ok: false, error: "Unit not found." };
  if (unit.status !== "AVAILABLE") return { ok: false, error: "Only available units can be deleted — this one is reserved or sold." };
  if (unit._count.deals > 0) return { ok: false, error: "This unit has a deal on record and can't be deleted." };

  try {
    // Any stray (pre-reservation) bookings cascade with the property.
    await prisma.property.delete({ where: { id: unit.id } });
  } catch {
    return { ok: false, error: "This unit is referenced elsewhere and can't be deleted." };
  }
  await logActivity({ companyId: user.companyId, userId: user.id, action: "unit.deleted", entityType: "PROPERTY", entityId: unit.projectId, summary: `Deleted unit ${unit.reference}` });
  if (unit.projectId) revalidatePath(`/projects/${unit.projectId}`);
  return { ok: true };
}

/* ───────────────────────────── Create-project wizard ───────────────────────── */

const AREA_UNITS = ["SQFT", "SQM", "SQYD", "MARLA", "KANAL"] as const;

const wizardSchema = z.object({
  name: z.string().min(2, "Project name is required"),
  status: z.enum(PROJECT_STATUSES).optional(),
  city: z.string().optional(),
  area: z.string().optional(),
  address: z.string().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  totalFloors: z.number().min(0).transform(roundInt).nullable().optional(),
  parkingFloors: z.number().min(0).transform(roundInt).nullable().optional(),
  description: z.string().optional(),
  isOffPlan: z.boolean().optional(),
  launchDate: z.string().optional(),
  completionDate: z.string().optional(),
  amenities: z.array(z.string()).optional(),
  unitTypes: z.array(z.object({
    key: z.string(),
    name: z.string().min(1),
    bedrooms: z.number().min(0).transform(roundInt).nullable().optional(),
    bathrooms: z.number().min(0).transform(roundInt).nullable().optional(),
    areaValue: z.number().min(0).nullable().optional(),
    areaUnit: z.enum(AREA_UNITS).optional(),
    basePrice: z.number().min(0),
    floorRise: z.number().min(0).optional(),
    // Placement: where this layout sits (drives generation when all are set).
    tower: z.string().optional(),
    floorFrom: z.number().transform(roundInt).nullable().optional(),
    floorTo: z.number().transform(roundInt).nullable().optional(),
    unitsPerFloor: z.number().min(1).transform(roundInt).nullable().optional(),
  })).optional(),
  // Legacy generic batches (still accepted); the wizard now drives generation
  // from per-type placement above.
  batches: z.array(z.object({
    tower: z.string().min(1),
    floorFrom: z.number().transform(roundInt),
    floorTo: z.number().transform(roundInt),
    unitsPerFloor: z.number().min(1).transform(roundInt),
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
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return { ok: false, error: i ? `${i.path.join(".") || "Form"}: ${i.message}` : "Please check the form." };
  }
  const d = parsed.data;
  const types = d.unitTypes ?? [];
  const batches = d.batches ?? [];

  // A unit type carries placement when its floor range + per-floor are all set.
  const hasPlacement = (t: (typeof types)[number]) =>
    t.floorFrom != null && t.floorTo != null && t.unitsPerFloor != null && t.unitsPerFloor >= 1;

  const typeByKey = new Map(types.map((t) => [t.key, t]));
  let totalUnits = 0;
  // Per-type placement (the wizard's source of inventory).
  for (const t of types) {
    const anyPlacement = t.floorFrom != null || t.floorTo != null || t.unitsPerFloor != null;
    if (!anyPlacement) continue;
    if (!hasPlacement(t)) return { ok: false, error: `Set the floors and units-per-floor for "${t.name}", or clear them.` };
    if (t.floorTo! < t.floorFrom!) return { ok: false, error: `"${t.name}": top floor must be ≥ bottom floor.` };
    totalUnits += (t.floorTo! - t.floorFrom! + 1) * t.unitsPerFloor!;
  }
  // Legacy generic batches.
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
        address: d.address || null,
        latitude: d.latitude ?? null,
        longitude: d.longitude ?? null,
        totalFloors: d.totalFloors ?? null,
        parkingFloors: d.parkingFloors ?? null,
        description: d.description || null,
        isOffPlan: !!d.isOffPlan,
        launchDate: d.launchDate ? new Date(d.launchDate) : null,
        completionDate: d.completionDate ? new Date(d.completionDate) : null,
        amenities: (d.amenities ?? []).filter((a) => AMENITY_SET.has(a)),
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
          tower: hasPlacement(t) ? (t.tower?.trim().toUpperCase() || "A") : null,
          floorFrom: t.floorFrom ?? null,
          floorTo: t.floorTo ?? null,
          unitsPerFloor: t.unitsPerFloor ?? null,
        },
        select: { id: true, name: true, bedrooms: true, bathrooms: true, areaValue: true, areaUnit: true, basePrice: true, floorRise: true },
      });
      createdByKey.set(t.key, { ...ut, basePrice: Number(ut.basePrice), floorRise: Number(ut.floorRise) });
    }

    const rows: Prisma.PropertyCreateManyInput[] = [];
    // Generate inventory from each unit type's placement.
    for (const t of types) {
      if (!hasPlacement(t)) continue;
      rows.push(...buildUnitRows({
        companyId: user.companyId,
        projectId: project.id,
        projectName: project.name,
        city: project.city,
        area: project.area,
        unitType: createdByKey.get(t.key)!,
        tower: t.tower?.trim() || "A",
        floorFrom: t.floorFrom!,
        floorTo: t.floorTo!,
        unitsPerFloor: t.unitsPerFloor!,
      }));
    }
    // Generate inventory for each legacy batch.
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

export type AiDescriptionResult = { ok: true; description: string } | { ok: false; reason: string };

/** Wizard: draft a project description with AI from the details entered so far. */
export async function aiProjectDescription(input: {
  name: string;
  status?: string;
  city?: string;
  area?: string;
  address?: string;
  totalFloors?: number | null;
  isOffPlan?: boolean;
  amenities?: string[];
  unitTypes?: { name: string; basePrice?: number | null }[];
  launchDate?: string;
  completionDate?: string;
}): Promise<AiDescriptionResult> {
  const { user, allowed } = await requireInventoryManager();
  if (!allowed) return { ok: false, reason: "Not allowed." };

  const res = await generateProjectCopy({ companyId: user.companyId, ...input });
  if (!res.ok) return { ok: false, reason: res.reason };
  return { ok: true, description: res.description };
}

/* ───────────────────────────── Media (project + units) ────────────────────── */

export interface MediaItem { id: string; kind: string; url: string; caption: string | null }

const mediaSchema = z.object({
  kind: z.enum(["PHOTO", "FLOOR_PLAN", "BROCHURE", "VIDEO"]).default("PHOTO"),
  url: z.string().min(1, "Upload a file first."),
  caption: z.string().optional(),
});
type MediaResult = { ok: true; media: MediaItem } | { ok: false; error: string };

/** Add a photo / floor plan / brochure to the project. */
export async function addProjectMedia(input: { projectId: string; kind: string; url: string; caption?: string }): Promise<MediaResult> {
  const { user, allowed } = await requireInventoryManager();
  if (!allowed) return { ok: false, error: "Not allowed." };
  const parsed = mediaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const proj = await prisma.project.findFirst({ where: { id: input.projectId, companyId: user.companyId }, select: { id: true } });
  if (!proj) return { ok: false, error: "Project not found." };

  const m = await prisma.projectMedia.create({
    data: { companyId: user.companyId, projectId: proj.id, kind: parsed.data.kind, url: parsed.data.url, caption: parsed.data.caption?.trim() || null },
    select: { id: true, kind: true, url: true, caption: true },
  });
  revalidatePath(`/projects/${proj.id}`);
  return { ok: true, media: m };
}

export async function deleteProjectMedia(mediaId: string): Promise<{ ok: boolean; error?: string }> {
  const { user, allowed } = await requireInventoryManager();
  if (!allowed) return { ok: false, error: "Not allowed." };
  const m = await prisma.projectMedia.findFirst({ where: { id: mediaId, companyId: user.companyId }, select: { id: true, projectId: true } });
  if (!m) return { ok: false, error: "Not found." };
  await prisma.projectMedia.delete({ where: { id: m.id } });
  revalidatePath(`/projects/${m.projectId}`);
  return { ok: true };
}

/** A unit's photos / floor plans (lazy-loaded by the unit edit drawer). */
export async function unitMedia(unitId: string): Promise<MediaItem[]> {
  const { user, allowed } = await requireInventoryManager();
  if (!allowed) return [];
  const rows = await prisma.propertyMedia.findMany({
    where: { propertyId: unitId, property: { companyId: user.companyId } },
    orderBy: { createdAt: "asc" },
    select: { id: true, kind: true, url: true, caption: true },
  });
  return rows;
}

/** Add a photo / floor plan to a unit. */
export async function addUnitMedia(input: { unitId: string; kind: string; url: string; caption?: string }): Promise<MediaResult> {
  const { user, allowed } = await requireInventoryManager();
  if (!allowed) return { ok: false, error: "Not allowed." };
  const parsed = mediaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const unit = await prisma.property.findFirst({ where: { id: input.unitId, companyId: user.companyId }, select: { id: true, projectId: true } });
  if (!unit) return { ok: false, error: "Unit not found." };

  const m = await prisma.propertyMedia.create({
    data: { propertyId: unit.id, kind: parsed.data.kind, url: parsed.data.url, caption: parsed.data.caption?.trim() || null },
    select: { id: true, kind: true, url: true, caption: true },
  });
  if (unit.projectId) revalidatePath(`/projects/${unit.projectId}`);
  return { ok: true, media: m };
}

export async function deleteUnitMedia(mediaId: string): Promise<{ ok: boolean; error?: string }> {
  const { user, allowed } = await requireInventoryManager();
  if (!allowed) return { ok: false, error: "Not allowed." };
  const m = await prisma.propertyMedia.findFirst({ where: { id: mediaId, property: { companyId: user.companyId } }, select: { id: true } });
  if (!m) return { ok: false, error: "Not found." };
  await prisma.propertyMedia.delete({ where: { id: m.id } });
  return { ok: true };
}
