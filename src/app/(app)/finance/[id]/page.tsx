import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCapability } from "@/lib/session";
import { dealPaymentProfile } from "@/lib/finance";
import { money, compactMoney, fmtDate, humanize } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { StatCard } from "@/components/ui/StatCard";
import { Table, Td } from "@/components/ui/Table";
import { StatusBadge } from "@/components/ui/Badge";

export default async function PaymentProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireCapability("managePayments");
  const profile = await dealPaymentProfile(user.companyId!, id);
  if (!profile) notFound();

  const { deal, buyer, property, dealer, total, paid, outstanding, overdue, pct, nextDue, schedule } = profile;
  const now = new Date();

  return (
    <div>
      <PageHeader
        eyebrow="Payment profile"
        title={deal.reference}
        subtitle={[buyer?.name, property?.title, property?.project].filter(Boolean).join(" · ") || undefined}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/deals/${deal.id}`} className="btn-ghost">Deal</Link>
            <Link href="/payments" className="btn-accent">Record payment</Link>
          </div>
        }
      />

      {/* Standing */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Contract value" value={compactMoney(total)} tone="ink" />
        <StatCard label="Collected" value={compactMoney(paid)} tone="ok" sub={`${pct}% paid`} />
        <StatCard label="Outstanding" value={compactMoney(outstanding)} tone="accent" />
        <StatCard label="Overdue" value={compactMoney(overdue)} tone={overdue > 0 ? "danger" : "default"} />
      </div>

      {/* Progress + next due */}
      <div className="mb-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="surface p-5">
          <div className="mb-2 flex items-end justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Collection progress</span>
            <span className="text-2xl font-bold leading-none text-ink">{pct}%</span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-line-soft">
            <div className="h-full rounded-full brand-gradient" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted">{money(paid)} collected of {money(total)} · {money(outstanding)} remaining{dealer ? ` · dealer: ${dealer}` : ""}</p>
        </div>
        <div className="surface p-5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Next payment due</span>
          {nextDue ? (
            <>
              <p className="mt-1 text-lg font-semibold text-ink">{money(nextDue.amount)}</p>
              <p className="text-sm text-muted">{nextDue.label}{nextDue.dueDate ? ` · ${fmtDate(nextDue.dueDate)}` : ""}</p>
            </>
          ) : (
            <p className="mt-1 text-sm font-medium text-ok">Fully paid ✓</p>
          )}
          {buyer?.portalEnabled && buyer.portalToken && (
            <Link href={`/portal/${buyer.portalToken}`} className="mt-3 inline-block text-xs font-semibold text-accent">Buyer portal →</Link>
          )}
        </div>
      </div>

      {/* Schedule */}
      <Section title={`Payment schedule (${schedule.length})`}>
        {schedule.length === 0 ? (
          <p className="text-sm text-muted">No payments on this deal yet.</p>
        ) : (
          <Table head={["Payment", "Amount", "Due", "Status", "Paid on", "Method / Receipt"]}>
            {schedule.map((s) => {
              const isOverdue = s.status !== "PAID" && !!s.dueDate && new Date(s.dueDate) < now;
              return (
                <tr key={s.id} className="hover:bg-line-soft">
                  <Td className="font-medium text-ink">{s.label}</Td>
                  <Td className="font-medium">{money(s.amount)}</Td>
                  <Td className="text-xs text-muted">{s.dueDate ? fmtDate(s.dueDate) : "—"}</Td>
                  <Td><StatusBadge status={isOverdue ? "OVERDUE" : s.status} /></Td>
                  <Td className="text-xs text-muted">{s.paidAt ? fmtDate(s.paidAt) : "—"}</Td>
                  <Td className="text-xs text-muted">{[s.method, s.receiptNo].filter(Boolean).join(" · ") || "—"}</Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Section>

      <p className="mt-3 text-xs text-muted">{humanize(deal.type)} deal · status {humanize(deal.status)}</p>
    </div>
  );
}
