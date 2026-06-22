"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma, runUnscoped } from "@/lib/prisma";
import { requireCompanyUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { logActivity } from "@/lib/activity";
import { nextInvoiceReference } from "@/lib/refs";
import { toNumber } from "@/lib/format";

export type FormState = { error?: string; fieldErrors?: Record<string, string[]>; ok?: boolean };

const createSchema = z.object({
  dealId: z.string().optional(),
  clientId: z.string().optional(),
  amount: z.coerce.number().positive("Amount must be positive"),
  dueDate: z.string().optional(),
  description: z.string().max(500).optional(),
  // status starts ISSUED unless explicitly DRAFT.
  asDraft: z.coerce.boolean().optional(),
  redirectTo: z.string().optional(),
});

/**
 * Create a new invoice. Office-only (uses managePayments — invoices and
 * payments belong to the same finance capability).
 */
export async function createInvoice(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireCompanyUser();
  if (!can(user.role, "managePayments")) return { error: "Not allowed." };

  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: "Please fix the errors below.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const d = parsed.data;

  // Verify any linked deal/client belong to this tenant.
  if (d.dealId) {
    const deal = await prisma.deal.findFirst({ where: { id: d.dealId, companyId: user.companyId } });
    if (!deal) return { error: "Linked deal not found." };
  }
  if (d.clientId) {
    const client = await prisma.client.findFirst({ where: { id: d.clientId, companyId: user.companyId } });
    if (!client) return { error: "Linked client not found." };
  }

  // Allocate number + create with retry on P2002 (same pattern as createProperty).
  let invoice: Awaited<ReturnType<typeof prisma.invoice.create>> | null = null;
  const data = {
    companyId: user.companyId,
    dealId: d.dealId || null,
    clientId: d.clientId || null,
    amount: new Prisma.Decimal(d.amount),
    status: d.asDraft ? ("DRAFT" as const) : ("ISSUED" as const),
    description: d.description?.trim() || null,
    dueDate: d.dueDate ? new Date(d.dueDate) : null,
  };

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      invoice = await prisma.invoice.create({
        data: { ...data, number: await nextInvoiceReference(user.companyId) },
      });
      break;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
      throw e;
    }
  }
  if (!invoice) return { error: "Could not allocate an invoice number. Try again." };

  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: "invoice.created",
    entityType: "INVOICE",
    entityId: invoice.id,
    summary: `Issued invoice ${invoice.number} for ${d.amount}`,
    meta: { number: invoice.number, amount: d.amount, dealId: d.dealId ?? null },
  });

  revalidatePath("/invoices");
  if (d.dealId) revalidatePath(`/deals/${d.dealId}`);
  redirect(d.redirectTo || `/invoices/${invoice.id}`);
}

/**
 * Mark an invoice CANCELLED. Stays in the DB for audit; cancelled invoices
 * are excluded from outstanding-balance math.
 */
export async function cancelInvoice(formData: FormData): Promise<void> {
  const user = await requireCompanyUser();
  if (!can(user.role, "managePayments")) return;

  const id = String(formData.get("id"));
  const invoice = await prisma.invoice.findFirst({ where: { id, companyId: user.companyId } });
  if (!invoice) return;
  if (invoice.status === "CANCELLED") return;

  await prisma.invoice.update({ where: { id }, data: { status: "CANCELLED" } });
  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: "invoice.cancelled",
    entityType: "INVOICE",
    entityId: id,
    summary: `Cancelled invoice ${invoice.number}`,
    meta: { from: invoice.status, to: "CANCELLED" },
  });
  revalidatePath(`/invoices/${id}`);
  revalidatePath("/invoices");
}

/**
 * Recompute and persist an invoice's status based on linked PAID payments.
 * Called from payment actions whenever a payment is added/marked paid.
 *
 * Rules:
 *  - sum(linked PAID amounts) >= invoice.amount  → PAID
 *  - sum > 0 but < amount                        → keep current (could be PARTIAL later)
 *  - status DRAFT or CANCELLED                   → untouched
 */
export async function recomputeInvoiceStatus(invoiceId: string): Promise<void> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, amount: true, status: true, companyId: true, number: true },
  });
  if (!invoice) return;
  if (invoice.status === "DRAFT" || invoice.status === "CANCELLED") return;

  const agg = await runUnscoped(
    "scoped to a single tenant-owned invoice (invoiceId), already fetched under tenant scope",
    () => prisma.payment.aggregate({ where: { invoiceId, status: "PAID" }, _sum: { amount: true } }),
  );
  const paid = toNumber(agg._sum.amount);
  const total = toNumber(invoice.amount);

  const next = paid >= total ? "PAID" : "ISSUED";
  if (next === invoice.status) return;

  await prisma.invoice.update({ where: { id: invoiceId }, data: { status: next } });
  await logActivity({
    companyId: invoice.companyId,
    action: "invoice.status",
    entityType: "INVOICE",
    entityId: invoiceId,
    summary:
      next === "PAID"
        ? `Invoice ${invoice.number} fully paid (${paid.toLocaleString()} / ${total.toLocaleString()})`
        : `Invoice ${invoice.number} status → ${next}`,
    meta: { from: invoice.status, to: next, paid, total },
  });
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/invoices");
}
