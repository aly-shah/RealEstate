"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCompanyUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { logActivity } from "@/lib/activity";
import { recomputeInvoiceStatus } from "@/app/(app)/invoices/actions";
import { setFlash } from "@/lib/flash";
import { runOnce } from "@/lib/idempotency";
import { casUpdateGuarded } from "@/lib/concurrency";
import { invalidateCompanyMetrics } from "@/lib/metrics";
import { humanize } from "@/lib/format";

export interface OutstandingItem { id: string; label: string; amount: number; dueDate: string | null; status: string }

/** A deal's outstanding scheduled payments (for the dynamic record-payment form). */
export async function dealOutstanding(dealId: string): Promise<OutstandingItem[]> {
  const user = await requireCompanyUser();
  if (!can(user.role, "managePayments") || !dealId) return [];
  const rows = await prisma.payment.findMany({
    where: { companyId: user.companyId, dealId, status: { in: ["PENDING", "PARTIAL", "OVERDUE"] } },
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
    select: { id: true, type: true, notes: true, amount: true, dueDate: true, status: true },
  });
  return rows.map((r) => ({
    id: r.id,
    label: r.notes || humanize(r.type),
    amount: Number(r.amount),
    dueDate: r.dueDate ? r.dueDate.toISOString() : null,
    status: r.status,
  }));
}

/** Mark a set of scheduled installments PAID in one go (optimistic-locked each). */
export async function payScheduled(input: {
  paymentIds: string[];
  paidAt?: string;
  method?: string;
  receiptNo?: string;
}): Promise<{ ok: boolean; count?: number; error?: string }> {
  const user = await requireCompanyUser();
  if (!can(user.role, "managePayments")) return { ok: false, error: "Not allowed." };
  const ids = [...new Set((input.paymentIds || []).filter(Boolean))];
  if (!ids.length) return { ok: false, error: "Select at least one installment." };

  const when = input.paidAt ? new Date(input.paidAt) : new Date();
  const method = input.method?.trim() || null;
  const receiptNo = input.receiptNo?.trim() || null;

  let count = 0;
  const invoiceIds = new Set<string>();
  const dealIds = new Set<string>();
  for (const id of ids) {
    const pay = await prisma.payment.findFirst({ where: { id, companyId: user.companyId }, select: { invoiceId: true, dealId: true } });
    if (!pay) continue;
    // CAS: only a not-yet-PAID row flips — two concurrent clicks can't double-pay.
    const moved = await casUpdateGuarded(
      prisma.payment,
      { id, companyId: user.companyId, status: { not: "PAID" } },
      { status: "PAID", paidAt: when, method, receiptNo },
    );
    if (moved) {
      count++;
      if (pay.invoiceId) invoiceIds.add(pay.invoiceId);
      if (pay.dealId) dealIds.add(pay.dealId);
    }
  }
  if (count === 0) return { ok: false, error: "Those installments were already paid." };

  for (const inv of invoiceIds) await recomputeInvoiceStatus(inv);
  await logActivity({
    companyId: user.companyId, userId: user.id, action: "payment.paid",
    entityType: "DEAL", entityId: [...dealIds][0] ?? null,
    summary: `Recorded ${count} installment payment(s)`, meta: { count },
  });
  invalidateCompanyMetrics(user.companyId);
  revalidatePath("/payments");
  for (const did of dealIds) revalidatePath(`/deals/${did}`);
  return { ok: true, count };
}

const paymentSchema = z.object({
  dealId: z.string().optional(),
  invoiceId: z.string().optional(),
  type: z.enum(["TOKEN", "BOOKING", "DOWN_PAYMENT", "INSTALMENT", "RENT", "DEPOSIT", "COMMISSION"]),
  amount: z.coerce.number().positive("Amount must be positive"),
  status: z.enum(["PENDING", "PARTIAL", "PAID", "OVERDUE"]),
  dueDate: z.string().optional(),
  method: z.string().optional(),
  receiptNo: z.string().optional(),
});

export type FormState = { error?: string; ok?: boolean };

export async function recordPayment(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireCompanyUser();
  if (!can(user.role, "managePayments")) return { error: "Not allowed." };

  const parsed = paymentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  // Tenant-verify any referenced invoice. If the payment links to an invoice,
  // auto-derive the dealId from the invoice when the form didn't supply one.
  let dealId = d.dealId || null;
  if (d.invoiceId) {
    const invoice = await prisma.invoice.findFirst({
      where: { id: d.invoiceId, companyId: user.companyId },
      select: { id: true, dealId: true },
    });
    if (!invoice) return { error: "Linked invoice not found." };
    if (!dealId && invoice.dealId) dealId = invoice.dealId;
  }

  const paymentData = {
    companyId: user.companyId,
    dealId,
    invoiceId: d.invoiceId || null,
    type: d.type,
    amount: new Prisma.Decimal(d.amount),
    status: d.status,
    method: d.method || null,
    receiptNo: d.receiptNo || null,
    dueDate: d.dueDate ? new Date(d.dueDate) : null,
    paidAt: d.status === "PAID" ? new Date() : null,
  };

  // Idempotency: when the form supplies a client-generated key, a double
  // submit replays the first result instead of recording a second payment.
  // Forms without the hidden `idempotencyKey` field keep the old behaviour.
  const idemKey = String(formData.get("idempotencyKey") || "").trim();
  if (idemKey) {
    const { replayed } = await runOnce(user.companyId, "payment.create", idemKey, () =>
      prisma.payment.create({ data: paymentData }),
    );
    if (replayed) {
      revalidatePath("/payments");
      return { ok: true };
    }
  } else {
    await prisma.payment.create({ data: paymentData });
  }

  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: "payment.recorded",
    entityType: dealId ? "DEAL" : d.invoiceId ? "INVOICE" : "PAYMENT",
    entityId: dealId ?? d.invoiceId ?? null,
    summary: `Payment ${d.status.toLowerCase()} — ${d.type}`,
    meta: { amount: d.amount, invoiceId: d.invoiceId ?? null, dealId },
  });

  // If the payment landed against an invoice with status PAID, see if the
  // invoice can now be marked PAID overall.
  if (d.invoiceId && d.status === "PAID") {
    await recomputeInvoiceStatus(d.invoiceId);
  }

  invalidateCompanyMetrics(user.companyId);
  revalidatePath("/payments");
  if (dealId) revalidatePath(`/deals/${dealId}`);
  if (d.invoiceId) revalidatePath(`/invoices/${d.invoiceId}`);
  return { ok: true };
}

export async function markPaymentPaid(formData: FormData): Promise<void> {
  const user = await requireCompanyUser();
  if (!can(user.role, "managePayments")) return;

  const id = String(formData.get("id"));
  const payment = await prisma.payment.findFirst({ where: { id, companyId: user.companyId } });
  if (!payment) return;

  // Compare-and-swap: only flips a not-yet-PAID row, so two concurrent
  // "mark paid" clicks can't both pass a stale read and double-process.
  const moved = await casUpdateGuarded(
    prisma.payment,
    { id, companyId: user.companyId, status: { not: "PAID" } },
    { status: "PAID", paidAt: new Date() },
  );
  if (!moved) {
    await setFlash({ tone: "ok", message: "Payment was already marked paid." });
    revalidatePath("/payments");
    return;
  }

  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: "payment.paid",
    entityType: payment.dealId ? "DEAL" : payment.invoiceId ? "INVOICE" : "PAYMENT",
    entityId: payment.dealId ?? payment.invoiceId,
    summary: "Payment marked paid",
    meta: { amount: Number(payment.amount), invoiceId: payment.invoiceId, dealId: payment.dealId },
  });

  if (payment.invoiceId) await recomputeInvoiceStatus(payment.invoiceId);

  invalidateCompanyMetrics(user.companyId);
  await setFlash({ tone: "ok", message: "Payment marked paid." });
  revalidatePath("/payments");
  if (payment.dealId) revalidatePath(`/deals/${payment.dealId}`);
  if (payment.invoiceId) revalidatePath(`/invoices/${payment.invoiceId}`);
}
