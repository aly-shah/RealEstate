"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCompanyUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { logActivity } from "@/lib/activity";

const showingSchema = z.object({
  propertyId: z.string().min(1, "Property is required"),
  clientId: z.string().optional(),
  manualLocation: z.string().optional(),
  lat: z.string().optional(),
  lng: z.string().optional(),
  notes: z.string().optional(),
  clientFeedback: z.string().optional(),
  interestLevel: z.enum(["HIGH", "MEDIUM", "LOW", "NONE"]).optional(),
});

export type FormState = { error?: string; ok?: boolean };

export async function recordShowing(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireCompanyUser();
  if (!can(user.role, "updateLeadsVisits")) return { error: "Not allowed." };

  const parsed = showingSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Please select a property." };
  const d = parsed.data;

  const lat = d.lat ? Number(d.lat) : null;
  const lng = d.lng ? Number(d.lng) : null;
  const now = new Date();

  const showing = await prisma.showing.create({
    data: {
      companyId: user.companyId,
      agentId: user.id,
      propertyId: d.propertyId,
      clientId: d.clientId || null,
      checkInAt: now,
      checkOutAt: now,
      checkInLat: lat,
      checkInLng: lng,
      manualLocation: d.manualLocation || null,
      notes: d.notes || null,
      clientFeedback: d.clientFeedback || null,
      interestLevel: d.interestLevel ?? null,
      gpsLogs: lat && lng ? { create: [{ kind: "IN", latitude: lat, longitude: lng }] } : undefined,
    },
  });

  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: "showing.recorded",
    entityType: "PROPERTY",
    entityId: d.propertyId,
    summary: "Property shown — visit recorded",
    meta: { showingId: showing.id },
  });

  revalidatePath("/visits");
  return { ok: true };
}

export async function verifyShowing(formData: FormData): Promise<void> {
  const user = await requireCompanyUser();
  if (!can(user.role, "assignLeadsCalendars")) return;

  const id = String(formData.get("id"));
  const status = String(formData.get("status")) as Prisma.ShowingUpdateInput["verification"];

  const showing = await prisma.showing.findFirst({ where: { id, companyId: user.companyId } });
  if (!showing) return;

  await prisma.showing.update({ where: { id }, data: { verification: status } });
  revalidatePath("/visits");
}
