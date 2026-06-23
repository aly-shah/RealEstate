"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCompanyUser, isScopedToSelf, type SessionUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { casUpdate, casUpdateGuarded } from "@/lib/concurrency";
import { logActivity } from "@/lib/activity";

export type FormState = { ok?: boolean; error?: string; fieldErrors?: Record<string, string[]> };

/** The dealer record for a DEALER user (used to scope allocation + bookings). */
async function dealerFor(user: SessionUser): Promise<string | null> {
  if (user.role !== "DEALER") return null;
  const d = await prisma.dealer.findFirst({ where: { companyId: user.companyId!, userId: user.id }, select: { id: true } });
  return d?.id ?? "__none__";
}

const bookingSchema = z.object({
  propertyId: z.string().min(1, "Pick a unit"),
  clientId: z.string().optional(),
  clientName: z.string().optional(),
  clientPhone: z.string().optional(),
  price: z.coerce.number().min(0, "Price must be ≥ 0"),
  discount: z.coerce.number().min(0).optional(),
  notes: z.string().optional(),
});

/**
 * Dealer/agent books an AVAILABLE unit for a buyer. Reserves the unit
 * (AVAILABLE → RESERVED via an optimistic guard so two dealers can't book the
 * same unit), then records a PENDING booking for the office to approve. A dealer
 * may only book units allocated to them.
 */
export async function createBooking(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireCompanyUser();
  if (!can(user.role, "manageProperties")) return { error: "Not allowed." };

  const parsed = bookingSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Please fix the errors below.", fieldErrors: parsed.error.flatten().fieldErrors };
  const d = parsed.data;
  if (!d.clientId && !d.clientName?.trim()) return { error: "Pick a client or enter the buyer's name." };

  const dealerId = await dealerFor(user);
  const unit = await prisma.property.findFirst({
    where: { id: d.propertyId, companyId: user.companyId, ...(dealerId ? { dealerId } : {}) },
    select: { id: true, status: true, reference: true },
  });
  if (!unit) return { error: "Unit not found or not allocated to you." };
  if (unit.status !== "AVAILABLE") return { error: "That unit is no longer available." };

  // Hold the unit: only flips if it's still AVAILABLE (loses the race → error).
  const held = await casUpdateGuarded(
    prisma.property,
    { id: unit.id, companyId: user.companyId, status: "AVAILABLE" },
    { status: "RESERVED" },
  );
  if (!held) return { error: "That unit was just taken — try another." };

  const booking = await prisma.booking.create({
    data: {
      companyId: user.companyId,
      propertyId: unit.id,
      dealerId: dealerId && dealerId !== "__none__" ? dealerId : null,
      clientId: d.clientId || null,
      clientName: d.clientName?.trim() || null,
      clientPhone: d.clientPhone?.trim() || null,
      bookedById: user.id,
      price: new Prisma.Decimal(d.price),
      discount: d.discount != null ? new Prisma.Decimal(d.discount) : null,
      notes: d.notes?.trim() || null,
    },
  });

  await logActivity({
    companyId: user.companyId, userId: user.id, action: "booking.created",
    entityType: "PROPERTY", entityId: unit.id,
    summary: `Booked unit ${unit.reference} (pending approval)`,
    meta: { bookingId: booking.id, price: d.price },
  });

  revalidatePath("/bookings");
  return { ok: true };
}

/** Office approves a pending booking: booking → APPROVED, unit RESERVED → SOLD. */
export async function approveBooking(bookingId: string): Promise<FormState> {
  const user = await requireCompanyUser();
  if (isScopedToSelf(user.role)) return { error: "Not allowed." };

  const b = await prisma.booking.findFirst({
    where: { id: bookingId, companyId: user.companyId, status: "PENDING" },
    select: { id: true, version: true, propertyId: true },
  });
  if (!b) return { error: "Booking not found or already processed." };

  try {
    await casUpdate(prisma.booking, b.id, user.companyId, b.version, {
      status: "APPROVED", reviewedById: user.id, reviewedAt: new Date(),
    });
  } catch {
    return { error: "This booking changed — reload and try again." };
  }
  // Mark the unit SOLD (only if still RESERVED — guards a double action).
  await casUpdateGuarded(prisma.property, { id: b.propertyId, companyId: user.companyId, status: "RESERVED" }, { status: "SOLD" });

  await logActivity({
    companyId: user.companyId, userId: user.id, action: "booking.approved",
    entityType: "PROPERTY", entityId: b.propertyId, summary: `Approved booking — unit marked sold`,
    meta: { bookingId: b.id },
  });
  revalidatePath("/bookings");
  return { ok: true };
}

/** Office rejects a pending booking: booking → REJECTED, unit RESERVED → AVAILABLE. */
export async function rejectBooking(bookingId: string, note?: string): Promise<FormState> {
  const user = await requireCompanyUser();
  if (isScopedToSelf(user.role)) return { error: "Not allowed." };

  const b = await prisma.booking.findFirst({
    where: { id: bookingId, companyId: user.companyId, status: "PENDING" },
    select: { id: true, version: true, propertyId: true },
  });
  if (!b) return { error: "Booking not found or already processed." };

  try {
    await casUpdate(prisma.booking, b.id, user.companyId, b.version, {
      status: "REJECTED", reviewedById: user.id, reviewedAt: new Date(), reviewNote: note?.trim() || null,
    });
  } catch {
    return { error: "This booking changed — reload and try again." };
  }
  await casUpdateGuarded(prisma.property, { id: b.propertyId, companyId: user.companyId, status: "RESERVED" }, { status: "AVAILABLE" });

  await logActivity({
    companyId: user.companyId, userId: user.id, action: "booking.rejected",
    entityType: "PROPERTY", entityId: b.propertyId, summary: `Rejected booking — unit released`,
    meta: { bookingId: b.id },
  });
  revalidatePath("/bookings");
  return { ok: true };
}

/** The creator (or office) cancels their own pending booking, releasing the unit. */
export async function cancelBooking(bookingId: string): Promise<FormState> {
  const user = await requireCompanyUser();
  const office = !isScopedToSelf(user.role);
  const b = await prisma.booking.findFirst({
    where: { id: bookingId, companyId: user.companyId, status: "PENDING", ...(office ? {} : { bookedById: user.id }) },
    select: { id: true, version: true, propertyId: true },
  });
  if (!b) return { error: "Booking not found or already processed." };

  try {
    await casUpdate(prisma.booking, b.id, user.companyId, b.version, { status: "CANCELLED" });
  } catch {
    return { error: "This booking changed — reload and try again." };
  }
  await casUpdateGuarded(prisma.property, { id: b.propertyId, companyId: user.companyId, status: "RESERVED" }, { status: "AVAILABLE" });

  revalidatePath("/bookings");
  return { ok: true };
}
