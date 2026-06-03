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

  await prisma.payment.create({
    data: {
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
    },
  });

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
  if (payment.status === "PAID") return;

  await prisma.payment.update({ where: { id }, data: { status: "PAID", paidAt: new Date() } });
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

  await setFlash({ tone: "ok", message: "Payment marked paid." });
  revalidatePath("/payments");
  if (payment.dealId) revalidatePath(`/deals/${payment.dealId}`);
  if (payment.invoiceId) revalidatePath(`/invoices/${payment.invoiceId}`);
}
