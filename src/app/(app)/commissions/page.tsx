import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCompanyUser } from "@/lib/session";
import { isScopedToSelf } from "@/lib/session";
import { commissionTotals } from "@/lib/metrics";
import { companyCommissionForecast, agentCommissionForecast } from "@/lib/commissions/forecast";
import { money, fmtDate, toNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Table, Td } from "@/components/ui/Table";
import { StatusBadge } from "@/components/ui/Badge";
import { StatCard } from "@/components/ui/StatCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { OwnerForecast, AgentForecastCards } from "./ForecastPanels";

export default async function CommissionsPage() {
  const user = await requireCompanyUser();

  // Office sees all; agents/dealers see commissions where they hold a share.
  let where: Prisma.CommissionWhereInput = { companyId: user.companyId };
  if (isScopedToSelf(user.role)) {
    if (user.role === "DEALER") {
      const dealer = await prisma.dealer.findFirst({
        where: { companyId: user.companyId, userId: user.id },
        select: { id: true },
      });
      where = { companyId: user.companyId, shares: { some: { dealerId: dealer?.id ?? "__none__" } } };
    } else {
      where = { companyId: user.companyId, shares: { some: { userId: user.id } } };
    }
  }

  const isOffice = !isScopedToSelf(user.role);
  const [commissions, totals, ownerForecast, agentForecast] = await Promise.all([
    prisma.commission.findMany({
      where,
      include: { deal: { include: { property: true } }, shares: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    isOffice ? commissionTotals(user.companyId) : null,
    isOffice ? companyCommissionForecast(user.companyId) : null,
    user.role === "AGENT" ? agentCommissionForecast(user.companyId, user.id) : null,
  ]);

  return (
    <div>
      <PageHeader eyebrow="Money" title="Commissions" subtitle="Automatic splits, approvals and payout history." />

      {totals && (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
          <StatCard label="Total commission" value={money(totals.total)} tone="ink" />
          <StatCard label="Paid" value={money(totals.paid)} tone="accent" />
          <StatCard label="Pending" value={money(totals.pending)} />
        </div>
      )}

      {ownerForecast && <OwnerForecast data={ownerForecast} />}
      {agentForecast && <AgentForecastCards data={agentForecast} />}

      {commissions.length === 0 ? (
        <EmptyState title="No commissions yet" hint="Commissions appear when a deal is closed-won and split." />
      ) : (
        <Table head={["Deal", "Property", "Total", "Shares", "Status", "Created"]}>
          {commissions.map((c) => (
            <tr key={c.id} className="hover:bg-line-soft">
              <Td><Link href={`/commissions/${c.id}`} className="font-semibold text-ink hover:text-accent">{c.deal.reference}</Link></Td>
              <Td className="max-w-[200px] truncate">{c.deal.property.title}</Td>
              <Td className="font-medium">{money(c.totalAmount)}</Td>
              <Td className="text-xs text-muted">{c.shares.length} parties · {money(c.shares.filter((s) => s.paid).reduce((s, x) => s + toNumber(x.amount), 0))} paid</Td>
              <Td><StatusBadge status={c.status} /></Td>
              <Td className="text-xs text-muted">{fmtDate(c.createdAt)}</Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
