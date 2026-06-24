import Link from "next/link";
import { requireCapability } from "@/lib/session";
import { financeOverview } from "@/lib/finance";
import { money, compactMoney, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { StatCard } from "@/components/ui/StatCard";
import { Table, Td } from "@/components/ui/Table";
import { EmptyState } from "@/components/ui/EmptyState";

export default async function FinancePage() {
  const user = await requireCapability("managePayments");
  const fin = await financeOverview(user.companyId!);
  const maxMonth = Math.max(1, ...fin.monthly.map((m) => m.amount));

  return (
    <div>
      <PageHeader eyebrow="Money" title="Finance dashboard" subtitle="Collections, what's due, what's overdue, and every deal's payment standing." />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Collected" value={compactMoney(fin.collected)} tone="ok" sub={`${fin.counts.paid} payments`} />
        <StatCard label="This month" value={compactMoney(fin.collectedThisMonth)} tone="accent" />
        <StatCard label="Outstanding" value={compactMoney(fin.outstanding)} tone="ink" sub={`${fin.counts.outstanding} due`} />
        <StatCard label="Overdue" value={compactMoney(fin.overdue)} tone="danger" sub={fin.counts.overdue ? `${fin.counts.overdue} payments` : "all on track"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Upcoming due */}
        <Section title="Upcoming collections">
          <Table head={["Window", "Payments", "Amount"]}>
            {fin.buckets.map((b) => (
              <tr key={b.key} className="hover:bg-line-soft">
                <Td className="font-medium text-ink">{b.label}</Td>
                <Td className="text-muted">{b.count}</Td>
                <Td className="font-semibold">{money(b.amount)}</Td>
              </tr>
            ))}
          </Table>
        </Section>

        {/* Collections trend */}
        <Section title="Collections — last 6 months">
          <div className="flex h-40 items-end justify-between gap-2 px-1">
            {fin.monthly.map((m) => (
              <div key={m.key} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex w-full flex-1 items-end">
                  <div className="w-full rounded-t brand-gradient" style={{ height: `${Math.round((m.amount / maxMonth) * 100)}%`, minHeight: m.amount > 0 ? 4 : 0 }} title={money(m.amount)} />
                </div>
                <span className="text-[10px] text-muted">{m.label}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-center text-xs text-muted">Peak month: {money(maxMonth)}</p>
        </Section>
      </div>

      {/* Overdue */}
      <Section title={`Overdue${fin.counts.overdue ? ` (${fin.counts.overdue})` : ""}`} className="mt-6">
        {fin.overdueList.length === 0 ? (
          <p className="text-sm text-muted">Nothing overdue — collections are on track. 🎉</p>
        ) : (
          <Table head={["Deal", "Buyer", "Payment", "Amount", "Due", "Overdue"]}>
            {fin.overdueList.map((o) => (
              <tr key={o.id} className="hover:bg-line-soft">
                <Td>{o.dealId ? <Link href={`/finance/${o.dealId}`} className="font-semibold text-ink hover:text-accent">{o.dealRef}</Link> : o.dealRef}</Td>
                <Td className="text-muted">{o.buyer}</Td>
                <Td className="text-muted">{o.label}</Td>
                <Td className="font-medium">{money(o.amount)}</Td>
                <Td className="text-xs text-muted">{o.dueDate ? fmtDate(o.dueDate) : "—"}</Td>
                <Td><span className="text-xs font-semibold text-danger">{o.daysOverdue}d</span></Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      {/* Payment profiles per deal */}
      <Section title="Payment profiles" className="mt-6">
        {fin.profiles.length === 0 ? (
          <EmptyState title="No payment schedules yet" hint="Approve a booking with a payment plan, or record payments against a deal." />
        ) : (
          <Table head={["Deal", "Buyer", "Property", "Collected", "Outstanding", "Progress", "Next due"]}>
            {fin.profiles.map((p) => (
              <tr key={p.dealId} className="hover:bg-line-soft">
                <Td><Link href={`/finance/${p.dealId}`} className="font-semibold text-ink hover:text-accent">{p.dealRef}</Link></Td>
                <Td className="text-muted">{p.buyer}</Td>
                <Td className="max-w-[180px] truncate text-muted">{p.property}</Td>
                <Td className="font-medium">{money(p.paid)}</Td>
                <Td className="text-muted">{money(p.outstanding)}</Td>
                <Td>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-line-soft"><div className="h-full rounded-full brand-gradient" style={{ width: `${p.pct}%` }} /></div>
                    <span className="text-xs font-medium text-ink">{p.pct}%</span>
                  </div>
                </Td>
                <Td className="text-xs text-muted">{p.nextDue ? fmtDate(p.nextDue) : "—"}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </div>
  );
}
