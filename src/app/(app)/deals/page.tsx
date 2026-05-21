import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCompanyUser } from "@/lib/session";
import { dealScope } from "@/lib/scope";
import { can } from "@/lib/rbac";
import { compactMoney, humanize, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Table, Td } from "@/components/ui/Table";
import { StatusBadge } from "@/components/ui/Badge";
import { FilterBar } from "@/components/ui/FilterBar";
import { EmptyState } from "@/components/ui/EmptyState";

const STATUSES = ["DRAFT", "NEGOTIATION", "TOKEN", "BOOKED", "AGREEMENT", "CLOSED_WON", "CLOSED_LOST"] as const;

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; type?: string }>;
}) {
  const user = await requireCompanyUser();
  const sp = await searchParams;
  const scope = await dealScope(user);

  const where: Prisma.DealWhereInput = {
    ...scope,
    ...(sp.status ? { status: sp.status as Prisma.DealWhereInput["status"] } : {}),
    ...(sp.type ? { type: sp.type as Prisma.DealWhereInput["type"] } : {}),
  };

  const deals = await prisma.deal.findMany({
    where,
    include: { property: true, client: true, sale: true, rental: true, commission: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div>
      <PageHeader
        eyebrow="Transactions"
        title="Deals"
        subtitle="Every sale and rental — money, people, paperwork and commission in one record."
        action={can(user.role, "recordDeals") ? <Link href="/deals/new" className="btn-accent">+ New deal</Link> : null}
      />

      <FilterBar
        filters={[
          { key: "status", label: "Status", options: STATUSES },
          { key: "type", label: "Type", options: ["SALE", "RENTAL"] },
        ]}
      />

      {deals.length === 0 ? (
        <EmptyState title="No deals yet" hint="Record a deal when a property is sold or rented." />
      ) : (
        <Table head={["Reference", "Type", "Property", "Client", "Value", "Status", "Closed"]}>
          {deals.map((d) => (
            <tr key={d.id} className="hover:bg-line-soft">
              <Td><Link href={`/deals/${d.id}`} className="font-semibold text-ink hover:text-accent">{d.reference}</Link></Td>
              <Td>{humanize(d.type)}</Td>
              <Td className="max-w-[200px] truncate">{d.property.title}</Td>
              <Td>{d.client?.name ?? "—"}</Td>
              <Td className="whitespace-nowrap font-medium">{compactMoney(d.sale?.salePrice ?? d.rental?.monthlyRent)}{d.rental ? "/mo" : ""}</Td>
              <Td><StatusBadge status={d.status} /></Td>
              <Td className="text-xs text-muted">{fmtDate(d.closeDate)}</Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
