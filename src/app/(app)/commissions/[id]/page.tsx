import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireCompanyUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { money, fmtDate, toNumber, humanize } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { approveCommission, markSharePaid, rejectCommission } from "../actions";

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
              {commission.shares.map((s) => {
                // Highlight the COMPANY share so the owner can see at a glance
                // what the house earned — financial sanity check during approval.
                const isCompany = s.party === "COMPANY";
                return (
                  <li
                    key={s.id}
                    className={`flex items-center justify-between py-3 ${
                      isCompany ? "-mx-2 rounded-lg bg-accent-wash/50 px-2" : ""
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-ink">{s.label}</p>
                        {isCompany && <Badge tone="accent">Company share</Badge>}
                      </div>
                      <p className="text-xs text-muted">
                        {humanize(s.party)} · {toNumber(s.pct)}%
                        {s.paidAt ? ` · paid ${fmtDate(s.paidAt)}` : ""}
                      </p>
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
                );
              })}
            </ul>
          </Section>

          {/* Approval note surfaces inline — relevant context that lives on the row. */}
          {commission.approvalNote && commission.status !== "PENDING_APPROVAL" && (
            <div className="mt-4 rounded-xl border border-line bg-line-soft/60 px-4 py-3 text-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Approval note</p>
              <p className="mt-1 text-ink">{commission.approvalNote}</p>
              {commission.approvedBy && (
                <p className="mt-1 text-xs text-muted">
                  — {commission.approvedBy.name}, {fmtDate(commission.approvedAt)}
                </p>
              )}
            </div>
          )}
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
              <div className="space-y-3">
                <form action={approveCommission} className="space-y-2">
                  <input type="hidden" name="id" value={commission.id} />
                  <div>
                    <label className="label" htmlFor="approvalNote">Note (optional)</label>
                    <input
                      id="approvalNote"
                      name="approvalNote"
                      className="field"
                      maxLength={300}
                      placeholder="e.g. Approved with reduced co-agent share"
                    />
                  </div>
                  <button className="btn-accent w-full">Approve commission</button>
                </form>
                <details className="rounded-lg border border-line p-3">
                  <summary className="cursor-pointer text-xs font-medium text-danger">
                    Reject this proposal
                  </summary>
                  <form action={rejectCommission} className="mt-3 space-y-2">
                    <input type="hidden" name="id" value={commission.id} />
                    <div>
                      <label className="label" htmlFor="reason">Reason</label>
                      <textarea
                        id="reason"
                        name="reason"
                        rows={2}
                        required
                        minLength={3}
                        maxLength={500}
                        className="field"
                        placeholder="Why is this commission being rejected?"
                      />
                    </div>
                    <button className="btn-ghost w-full text-sm text-danger">
                      Reject &amp; remove
                    </button>
                    <p className="text-[11px] text-muted">
                      The commission row is deleted; the rejection + reason is preserved in the activity log.
                      You can regenerate a new commission from the deal page.
                    </p>
                  </form>
                </details>
              </div>
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
