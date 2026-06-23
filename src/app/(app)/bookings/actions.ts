"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCompanyUser, isScopedToSelf, type SessionUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { casUpdate, casUpdateGuarded } from "@/lib/concurrency";
import { logActivity, notify } from "@/lib/activity";
import { invalidateCompanyMetrics } from "@/lib/metrics";
import { nextDealReference } from "@/lib/refs";
import { expandSchedule } from "@/lib/payment-plan";

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
  paymentPlanId: z.string().optional(),
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
      paymentPlanId: d.paymentPlanId || null,
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

/**
 * Office approves a pending booking. Atomically (one transaction): claims the
 * booking (PENDING → APPROVED, version-guarded), creates the revenue record
 * (a SALE Deal + Sale at the agreed price), generates the installment Payment
 * schedule from the chosen plan, marks the unit SOLD, and links the deal back
 * to the booking. The deal reference is allocated outside the txn with a
 * retry-on-collision loop (a P2002 inside a txn aborts it).
 */
export async function approveBooking(bookingId: string): Promise<FormState> {
  const user = await requireCompanyUser();
  if (isScopedToSelf(user.role)) return { error: "Not allowed." };
  const companyId = user.companyId;

  const b = await prisma.booking.findFirst({
    where: { id: bookingId, companyId, status: "PENDING" },
    select: { id: true, version: true, propertyId: true, clientId: true, dealerId: true, price: true, paymentPlanId: true, dealId: true },
  });
  if (!b) return { error: "Booking not found or already processed." };

  const price = Number(b.price);

  // Dealer commission (channel sale): the dealer earns their agreed share % of
  // the sale price. The builder keeps the rest as revenue, so this is a single
  // DEALER share — not a full GCI split. Generated as PENDING_APPROVAL so it
  // flows through the existing owner commission-approval queue.
  let dealerComm: { dealerId: string; name: string; pct: number; amount: number } | null = null;
  if (b.dealerId) {
    const dealer = await prisma.dealer.findFirst({
      where: { id: b.dealerId, companyId },
      select: { id: true, name: true, defaultSharePct: true },
    });
    const pct = Number(dealer?.defaultSharePct ?? 0);
    const amount = Math.round(((price * pct) / 100) * 100) / 100;
    if (dealer && pct > 0 && amount > 0) {
      dealerComm = { dealerId: dealer.id, name: dealer.name, pct, amount };
    }
  }

  // Resolve the installment schedule from the plan (read-only, before the txn).
  let scheduleRows: { type: "TOKEN" | "BOOKING" | "DOWN_PAYMENT" | "INSTALMENT" | "DEPOSIT"; label: string; amount: number; dueDate: Date }[] = [];
  if (b.paymentPlanId) {
    const plan = await prisma.paymentPlanTemplate.findFirst({
      where: { id: b.paymentPlanId, companyId },
      select: { milestones: { orderBy: { order: "asc" }, select: { label: true, pct: true, type: true, count: true, firstDueMonths: true, intervalMonths: true } } },
    });
    if (plan) {
      scheduleRows = expandSchedule(price, new Date(), plan.milestones.map((m) => ({
        label: m.label, pct: Number(m.pct), type: m.type, count: m.count, firstDueMonths: m.firstDueMonths, intervalMonths: m.intervalMonths,
      }))) as typeof scheduleRows;
    }
  }

  let dealId: string | null = null;
  let conflict = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    const reference = await nextDealReference(companyId);
    try {
      await prisma.$transaction(async (tx) => {
        // Claim the booking — version guard ensures a single approver.
        const claimed = await tx.booking.updateMany({
          where: { id: b.id, companyId, status: "PENDING", version: b.version },
          data: { status: "APPROVED", reviewedById: user.id, reviewedAt: new Date(), version: { increment: 1 } },
        });
        if (claimed.count === 0) { conflict = true; throw new Error("CONFLICT"); }

        const deal = await tx.deal.create({
          data: {
            companyId, reference, type: "SALE", status: "BOOKED",
            propertyId: b.propertyId, clientId: b.clientId, dealerId: b.dealerId,
            sale: { create: { salePrice: new Prisma.Decimal(price) } },
          },
          select: { id: true },
        });
        dealId = deal.id;

        if (scheduleRows.length) {
          await tx.payment.createMany({
            data: scheduleRows.map((s) => ({
              companyId, dealId: deal.id, type: s.type, notes: s.label,
              amount: new Prisma.Decimal(s.amount), status: "PENDING" as const, dueDate: s.dueDate,
            })),
          });
        }

        if (dealerComm) {
          await tx.commission.create({
            data: {
              companyId, dealId: deal.id,
              totalAmount: new Prisma.Decimal(dealerComm.amount),
              status: "PENDING_APPROVAL",
              shares: {
                create: [{
                  party: "DEALER", dealerId: dealerComm.dealerId, label: dealerComm.name,
                  pct: new Prisma.Decimal(dealerComm.pct), amount: new Prisma.Decimal(dealerComm.amount),
                }],
              },
            },
          });
        }

        await tx.property.updateMany({ where: { id: b.propertyId, companyId, status: "RESERVED" }, data: { status: "SOLD", version: { increment: 1 } } });
        await tx.booking.update({ where: { id: b.id }, data: { dealId: deal.id } });
      });
      break;
    } catch (e) {
      if (conflict) return { error: "This booking changed — reload and try again." };
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") { dealId = null; continue; }
      throw e;
    }
  }
  if (!dealId) return { error: "Could not allocate a deal reference. Try again." };

  // A dealer commission was created → it needs owner approval. Notify approvers.
  if (dealerComm) {
    const approvers = await prisma.user.findMany({
      where: { companyId, role: { in: ["OWNER", "ADMIN"] } },
      select: { id: true },
    });
    await Promise.all(approvers.map((a) => notify({
      companyId, userId: a.id, type: "COMMISSION_APPROVAL",
      title: `Commission to approve — ${dealerComm.name}`,
      link: "/commissions",
    })));
    invalidateCompanyMetrics(companyId);
  }

  await logActivity({
    companyId, userId: user.id, action: "booking.approved",
    entityType: "DEAL", entityId: dealId,
    summary: `Approved booking — deal + ${scheduleRows.length} payment(s)${dealerComm ? ` + ${Math.round(dealerComm.amount).toLocaleString()} dealer commission` : ""}`,
    meta: { bookingId: b.id, payments: scheduleRows.length, dealerCommission: dealerComm?.amount ?? 0 },
  });
  revalidatePath("/bookings");
  revalidatePath("/payments");
  if (dealerComm) revalidatePath("/commissions");
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
