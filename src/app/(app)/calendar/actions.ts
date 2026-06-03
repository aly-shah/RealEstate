"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCompanyUser } from "@/lib/session";
import { notify } from "@/lib/activity";

const eventSchema = z.object({
  title: z.string().min(2, "Title is required"),
  type: z.enum(["SHOWING", "MEETING", "FOLLOW_UP", "OPEN_HOUSE", "PAYMENT_REMINDER", "DOCUMENT_REMINDER", "RENTAL_RENEWAL", "DEAL_CLOSING"]),
  startAt: z.string().min(1, "Start time is required"),
  agentId: z.string().optional(),
  propertyId: z.string().optional(),
  leadId: z.string().optional(),
  notes: z.string().optional(),
});

export type FormState = { error?: string; fieldErrors?: Record<string, string[]> };

export async function createEvent(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireCompanyUser();

  const parsed = eventSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: "Please fix the errors below.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const d = parsed.data;
  const agentId = user.role === "AGENT" ? user.id : d.agentId || null;

  const event = await prisma.calendarEvent.create({
    data: {
      companyId: user.companyId,
      title: d.title,
      type: d.type,
      startAt: new Date(d.startAt),
      agentId,
      propertyId: d.propertyId || null,
      leadId: d.leadId || null,
      notes: d.notes || null,
    },
  });

  if (agentId && agentId !== user.id) {
    await notify({
      companyId: user.companyId,
      userId: agentId,
      type: "REMINDER",
      title: `New task: ${event.title}`,
      link: "/calendar",
    });
  }

  revalidatePath("/calendar");
  return {};
}

export async function setEventStatus(formData: FormData): Promise<void> {
  const user = await requireCompanyUser();
  const id = String(formData.get("id"));
  const status = String(formData.get("status")) as Prisma.CalendarEventUpdateInput["status"];

  const event = await prisma.calendarEvent.findFirst({ where: { id, companyId: user.companyId } });
  if (!event) return;
  if (user.role === "AGENT" && event.agentId !== user.id) return;

  await prisma.calendarEvent.update({ where: { id }, data: { status } });

  // Phase-7 refinement: marking a contact-style event DONE counts as a real
  // touch on the linked lead. Stays no-op for SCHEDULED/CANCELLED/MISSED
  // transitions and for non-contact event types (PAYMENT_REMINDER etc.).
  if (
    String(status) === "DONE" &&
    event.leadId &&
    (event.type === "FOLLOW_UP" || event.type === "MEETING" || event.type === "SHOWING")
  ) {
    await prisma.lead.updateMany({
      where: {
        id: event.leadId,
        companyId: user.companyId,
        stage: { notIn: ["CLOSED_WON", "CLOSED_LOST"] },
      },
      data: { lastContactedAt: new Date() },
    });
  }

  revalidatePath("/calendar");
}
