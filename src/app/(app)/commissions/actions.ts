"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireCompanyUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { logActivity, notify } from "@/lib/activity";

export async function approveCommission(formData: FormData): Promise<void> {
  const user = await requireCompanyUser();
  if (!can(user.role, "approveCommission")) return;

  const id = String(formData.get("id"));
  const commission = await prisma.commission.findFirst({
    where: { id, companyId: user.companyId },
    include: { deal: true, shares: true },
  });
  if (!commission) return;

  await prisma.commission.update({
    where: { id },
    data: { status: "APPROVED", approvedById: user.id, approvedAt: new Date() },
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
    summary: `Approved commission for ${commission.deal.reference}`,
  });
  revalidatePath(`/commissions/${id}`);
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
