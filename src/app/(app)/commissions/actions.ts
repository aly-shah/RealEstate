"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireCompanyUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { logActivity, notify } from "@/lib/activity";
import { setFlash } from "@/lib/flash";

export async function approveCommission(formData: FormData): Promise<void> {
  const user = await requireCompanyUser();
  if (!can(user.role, "approveCommission")) return;

  const id = String(formData.get("id"));
  const approvalNote = String(formData.get("approvalNote") || "").trim();

  const commission = await prisma.commission.findFirst({
    where: { id, companyId: user.companyId },
    include: { deal: true, shares: true },
  });
  if (!commission) return;
  if (commission.status !== "PENDING_APPROVAL") return; // idempotent

  await prisma.commission.update({
    where: { id },
    data: {
      status: "APPROVED",
      approvedById: user.id,
      approvedAt: new Date(),
      approvalNote: approvalNote || null,
    },
  });

  // Tell each agent their share is approved.
  await Promise.all(
    commission.shares
      .filter((s) => s.userId)
      .map((s) =>
        notify({
          companyId: user.companyId,
          userId: s.userId!,
          type: "GENERAL",
          title: `Commission approved — ${commission.deal.reference}`,
          link: `/commissions/${id}`,
        }),
      ),
  );

  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: "commission.approved",
    entityType: "DEAL",
    entityId: commission.dealId,
    summary: approvalNote
      ? `Approved commission for ${commission.deal.reference} — ${approvalNote}`
      : `Approved commission for ${commission.deal.reference}`,
    meta: { from: commission.status, to: "APPROVED", approvalNote: approvalNote || null },
  });
  await setFlash({ tone: "ok", message: `Commission for ${commission.deal.reference} approved.` });
  revalidatePath(`/commissions/${id}`);
  revalidatePath("/commissions");
}

/**
 * Reject a pending commission. The Commission row is deleted (so the deal
 * can have a new one regenerated), but the rejection is preserved in the
 * activity log with the reason — the audit trail lives there.
 */
export async function rejectCommission(formData: FormData): Promise<void> {
  const user = await requireCompanyUser();
  if (!can(user.role, "approveCommission")) return;

  const id = String(formData.get("id"));
  const reason = String(formData.get("reason") || "").trim();
  if (!reason) return; // server-side backstop; UI also requires it

  const commission = await prisma.commission.findFirst({
    where: { id, companyId: user.companyId },
    include: { deal: true, shares: { where: { userId: { not: null } }, select: { userId: true } } },
  });
  if (!commission) return;
  if (commission.status !== "PENDING_APPROVAL") return; // can't reject after approval

  // Capture the dealId before delete so we can revalidate + notify cleanly.
  const dealId = commission.dealId;
  const dealRef = commission.deal.reference;

  await prisma.commission.delete({ where: { id } });

  // Tell the agents who would have received a share that the proposal was rejected.
  await Promise.all(
    commission.shares.map((s) =>
      notify({
        companyId: user.companyId,
        userId: s.userId!,
        type: "COMMISSION_REJECTED",
        title: `Commission rejected — ${dealRef}`,
        body: reason,
        link: `/deals/${dealId}`,
      }),
    ),
  );

  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: "commission.rejected",
    entityType: "DEAL",
    entityId: dealId,
    summary: `Rejected commission for ${dealRef} — ${reason}`,
    meta: { rejectionReason: reason, totalAmount: Number(commission.totalAmount) },
  });

  revalidatePath(`/deals/${dealId}`);
  revalidatePath("/commissions");
}

export async function markSharePaid(formData: FormData): Promise<void> {
  const user = await requireCompanyUser();
  if (!can(user.role, "approveCommission")) return;

  const shareId = String(formData.get("shareId"));
  const share = await prisma.commissionShare.findFirst({
    where: { id: shareId, commission: { companyId: user.companyId } },
    include: { commission: true },
  });
  if (!share) return;

  await prisma.commissionShare.update({ where: { id: shareId }, data: { paid: true, paidAt: new Date() } });

  // If every share is paid, close out the commission.
  const remaining = await prisma.commissionShare.count({
    where: { commissionId: share.commissionId, paid: false },
  });
  if (remaining === 0) {
    await prisma.commission.update({ where: { id: share.commissionId }, data: { status: "PAID" } });
  }

  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: "commission.share_paid",
    entityType: "COMMISSION",
    entityId: share.commissionId,
    summary: `Paid share: ${share.label}`,
  });
  revalidatePath(`/commissions/${share.commissionId}`);
  revalidatePath("/commissions");
}
