"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCompanyUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { logActivity } from "@/lib/activity";
import { setFlash } from "@/lib/flash";

export type FormState = { error?: string; ok?: boolean };

// Trigger stages a sequence can fire on — the open pipeline (closed stages can't
// trigger nurture). "" means manual-enrolment only.
const TRIGGER_STAGES = [
  "NEW", "CONTACTED", "INTERESTED", "SITE_VISIT", "PROPERTY_SHOWN", "NEGOTIATION", "TOKEN_BOOKING", "PAYMENT",
] as const;

/** Returns the user when they may manage sequences, else null. */
async function gate() {
  const user = await requireCompanyUser();
  return can(user.role, "assignLeadsCalendars") ? user : null;
}

const sequenceSchema = z.object({
  name: z.string().min(2, "Name is required"),
  triggerStage: z.string().optional(),
  active: z.string().optional(),
});

export async function createSequence(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await gate();
  if (!user) return { error: "Not allowed." };

  const parsed = sequenceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;
  const triggerStage = (TRIGGER_STAGES as readonly string[]).includes(d.triggerStage ?? "")
    ? (d.triggerStage as (typeof TRIGGER_STAGES)[number])
    : null;

  const seq = await prisma.dripSequence.create({
    data: { companyId: user.companyId, name: d.name.trim(), triggerStage, active: false },
  });
  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: "sequence.created",
    entityType: "SEQUENCE",
    entityId: seq.id,
    summary: `Created drip sequence "${seq.name}"`,
  });
  redirect(`/sequences/${seq.id}`);
}

export async function updateSequence(formData: FormData): Promise<void> {
  const user = await gate();
  if (!user) return;
  const id = String(formData.get("id") || "");
  const seq = await prisma.dripSequence.findFirst({ where: { id, companyId: user.companyId }, select: { id: true } });
  if (!seq) return;

  const parsed = sequenceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    await setFlash({ tone: "danger", message: parsed.error.issues[0]?.message ?? "Invalid input." });
    revalidatePath(`/sequences/${id}`);
    return;
  }
  const d = parsed.data;
  const triggerStage = (TRIGGER_STAGES as readonly string[]).includes(d.triggerStage ?? "")
    ? (d.triggerStage as (typeof TRIGGER_STAGES)[number])
    : null;

  await prisma.dripSequence.update({
    where: { id },
    data: { name: d.name.trim(), triggerStage, active: d.active === "on" || d.active === "true" },
  });
  await setFlash({ tone: "ok", message: "Sequence saved." });
  revalidatePath(`/sequences/${id}`);
  revalidatePath("/sequences");
}

export async function deleteSequence(formData: FormData): Promise<void> {
  const user = await gate();
  if (!user) return;
  const id = String(formData.get("id") || "");
  const seq = await prisma.dripSequence.findFirst({ where: { id, companyId: user.companyId }, select: { id: true, name: true } });
  if (!seq) return;
  // Cascade removes its steps + enrollments.
  await prisma.dripSequence.delete({ where: { id } });
  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: "sequence.deleted",
    entityType: "SEQUENCE",
    entityId: id,
    summary: `Deleted drip sequence "${seq.name}"`,
  });
  await setFlash({ tone: "ok", message: "Sequence deleted." });
  redirect("/sequences");
}

const stepSchema = z.object({
  sequenceId: z.string().min(1),
  kind: z.enum(["WHATSAPP_TEMPLATE", "TASK"]),
  delayHours: z.coerce.number().int().min(0).max(8760), // ≤ 1 year
  // WHATSAPP_TEMPLATE: "name|language"; TASK: free text.
  template: z.string().optional(),
  taskTitle: z.string().optional(),
});

export async function addStep(formData: FormData): Promise<void> {
  const user = await gate();
  if (!user) return;
  const parsed = stepSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    await setFlash({ tone: "danger", message: parsed.error.issues[0]?.message ?? "Invalid step." });
    return;
  }
  const d = parsed.data;
  const seq = await prisma.dripSequence.findFirst({
    where: { id: d.sequenceId, companyId: user.companyId },
    select: { id: true, _count: { select: { steps: true } } },
  });
  if (!seq) return;

  let templateName: string | null = null;
  let templateLang: string | null = null;
  let taskTitle: string | null = null;

  if (d.kind === "WHATSAPP_TEMPLATE") {
    const [name, language] = (d.template ?? "").split("|");
    if (!name || !language) {
      await setFlash({ tone: "danger", message: "Pick an approved template for the WhatsApp step." });
      revalidatePath(`/sequences/${d.sequenceId}`);
      return;
    }
    const tpl = await prisma.whatsAppTemplate.findFirst({
      where: { companyId: user.companyId, name, language, status: "APPROVED" },
      select: { id: true },
    });
    if (!tpl) {
      await setFlash({ tone: "danger", message: "That template isn't approved." });
      revalidatePath(`/sequences/${d.sequenceId}`);
      return;
    }
    templateName = name;
    templateLang = language;
  } else {
    taskTitle = (d.taskTitle ?? "").trim() || "Follow up";
  }

  await prisma.dripStep.create({
    data: {
      sequenceId: d.sequenceId,
      order: seq._count.steps, // append
      kind: d.kind,
      delayHours: d.delayHours,
      templateName,
      templateLang,
      taskTitle,
    },
  });
  await setFlash({ tone: "ok", message: "Step added." });
  revalidatePath(`/sequences/${d.sequenceId}`);
}

export async function deleteStep(formData: FormData): Promise<void> {
  const user = await gate();
  if (!user) return;
  const id = String(formData.get("id") || "");
  const step = await prisma.dripStep.findFirst({
    where: { id, sequence: { companyId: user.companyId } },
    select: { id: true, sequenceId: true },
  });
  if (!step) return;
  await prisma.dripStep.delete({ where: { id } });
  revalidatePath(`/sequences/${step.sequenceId}`);
}

/** Swap a step's order with its neighbour in the given direction. */
export async function moveStep(formData: FormData): Promise<void> {
  const user = await gate();
  if (!user) return;
  const id = String(formData.get("id") || "");
  const dir = String(formData.get("dir") || "");
  const step = await prisma.dripStep.findFirst({
    where: { id, sequence: { companyId: user.companyId } },
    select: { id: true, sequenceId: true, order: true },
  });
  if (!step || (dir !== "up" && dir !== "down")) return;

  const neighbour = await prisma.dripStep.findFirst({
    where: {
      sequenceId: step.sequenceId,
      order: dir === "up" ? { lt: step.order } : { gt: step.order },
    },
    orderBy: { order: dir === "up" ? "desc" : "asc" },
    select: { id: true, order: true },
  });
  if (!neighbour) return; // already at the edge

  await prisma.$transaction([
    prisma.dripStep.update({ where: { id: step.id }, data: { order: neighbour.order } }),
    prisma.dripStep.update({ where: { id: neighbour.id }, data: { order: step.order } }),
  ]);
  revalidatePath(`/sequences/${step.sequenceId}`);
}
