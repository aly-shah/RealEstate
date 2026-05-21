import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireCompanyUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { money, fmtDate, toNumber, humanize } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { StatusBadge } from "@/components/ui/Badge";
import { approveCommission, markSharePaid } from "../actions";

export default async function CommissionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireCompanyUser();

  const commission = await prisma.commission.findFirst({
    where: { id, companyId: user.companyId },
    include: {
      deal: { include: { property: true } },
      approvedBy: true,
      shares: { include: { user: true } },
    },
  });
  if (!commission) notFound();

  const canApprove = can(user.role, "approveCommission");

  return (
    <div>
      <PageHeader
        eyebrow={`Commission · ${commission.deal.reference}`}
        title={money(commission.totalAmount)}
        subtitle={commission.deal.property.title}
        action={<StatusBadge status={commission.status} />}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Section title="Split breakdown">
            <ul className="divide-y divide-line">
              {commission.shares.map((s) => (
                <li key={s.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-semibold text-ink">{s.label}</p>
                    <p className="text-xs text-muted">{humanize(s.party)} · {toNumber(s.pct)}%{s.paidAt ? ` · paid ${fmtDate(s.paidAt)}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-ink">{money(s.amount)}</span>
                    {s.paid ? (
                      <StatusBadge status="PAID" />
                    ) : canApprove && commission.status === "APPROVED" ? (
                      <form action={markSharePaid}>
                        <input type="hidden" name="shareId" value={s.id} />
                        <button className="btn-ghost px-2 py-1 text-xs">Mark paid</button>
                      </form>
                    ) : (
                      <StatusBadge status="PENDING" />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="Status">
            <p className="mb-3 text-sm text-slate">
              {commission.status === "PENDING_APPROVAL" && "Waiting for owner/admin approval before payout."}
              {commission.status === "APPROVED" && `Approved${commission.approvedBy ? ` by ${commission.approvedBy.name}` : ""}. Mark each share paid as it goes out.`}
              {commission.status === "PAID" && "All shares paid out."}
              {commission.status === "DRAFT" && "Draft."}
            </p>
            {canApprove && commission.status === "PENDING_APPROVAL" && (
              <form action={approveCommission}>
                <input type="hidden" name="id" value={commission.id} />
                <button className="btn-accent w-full">Approve commission</button>
              </form>
            )}
          </Section>

          <Section title="Linked deal">
            <Link href={`/deals/${commission.dealId}`} className="text-sm font-semibold text-accent">
              {commission.deal.reference} →
            </Link>
          </Section>
        </div>
      </div>
    </div>
  );
}
