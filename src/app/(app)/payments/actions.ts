"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCompanyUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { logActivity } from "@/lib/activity";

const paymentSchema = z.object({
  dealId: z.string().optional(),
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

  await prisma.payment.create({
    data: {
      companyId: user.companyId,
      dealId: d.dealId || null,
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
    entityType: d.dealId ? "DEAL" : "PAYMENT",
    entityId: d.dealId ?? null,
    summary: `Payment ${d.status.toLowerCase()} — ${d.type}`,
  });

  revalidatePath("/payments");
  if (d.dealId) revalidatePath(`/deals/${d.dealId}`);
  return { ok: true };
}

export async function markPaymentPaid(formData: FormData): Promise<void> {
  const user = await requireCompanyUser();
  if (!can(user.role, "managePayments")) return;

  const id = String(formData.get("id"));
  const payment = await prisma.payment.findFirst({ where: { id, companyId: user.companyId } });
  if (!payment) return;

  await prisma.payment.update({ where: { id }, data: { status: "PAID", paidAt: new Date() } });
  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: "payment.paid",
    entityType: payment.dealId ? "DEAL" : "PAYMENT",
    entityId: payment.dealId,
    summary: "Payment marked paid",
  });
  revalidatePath("/payments");
  if (payment.dealId) revalidatePath(`/deals/${payment.dealId}`);
}
