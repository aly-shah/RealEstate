import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/session";
import { money, compactMoney, fmtDate, toNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Table, Td } from "@/components/ui/Table";
import { StatCard } from "@/components/ui/StatCard";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { FilterBar } from "@/components/ui/FilterBar";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { parsePage } from "@/lib/pagination";

const STATUSES = ["DRAFT", "ISSUED", "PAID", "CANCELLED"] as const;

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string; pageSize?: string }>;
}) {
  const user = await requireCapability("managePayments");
  const companyId = user.companyId!;
  const sp = await searchParams;
  const { page, pageSize, skip } = parsePage(sp);
  const now = new Date();

  const where: Prisma.InvoiceWhereInput = {
    companyId,
    ...(sp.status ? { status: sp.status as Prisma.InvoiceWhereInput["status"] } : {}),
  };

  const [invoices, total, totalsAgg] = await Promise.all([
    prisma.invoice.findMany({
      where,
      include: {
        client: true,
        deal: { include: { client: true, property: { select: { reference: true, title: true } } } },
        payments: { where: { status: "PAID" }, select: { amount: true } },
      },
      orderBy: { issuedAt: "desc" },
      skip,
      take: pageSize,
    }),
    prisma.invoice.count({ where }),
    // Headline KPIs across the whole tenant (not affected by pagination).
    prisma.invoice.groupBy({
      by: ["status"],
      where: { companyId },
      _sum: { amount: true },
    }),
  ]);

  const totals = Object.fromEntries(totalsAgg.map((t) => [t.status, toNumber(t._sum.amount)]));
  const issuedTotal = totals.ISSUED ?? 0;
  const paidTotal = totals.PAID ?? 0;
  const draftTotal = totals.DRAFT ?? 0;

  return (
    <div>
      <PageHeader
        eyebrow="Billing"
        title="Invoices"
        subtitle="Issue, track and reconcile invoices against deal payments."
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Issued (open)" value={compactMoney(issuedTotal)} tone="accent" />
        <StatCard label="Paid (all-time)" value={compactMoney(paidTotal)} tone="ok" />
        <StatCard label="Drafts" value={compactMoney(draftTotal)} />
        <StatCard label="Invoices on file" value={total.toLocaleString()} tone="ink" />
      </div>

      <FilterBar
        showSearch={false}
        filters={[{ key: "status", label: "Status", options: STATUSES }]}
      />

      {invoices.length === 0 ? (
        <EmptyState
          title="No invoices yet"
          hint="Open a deal and click ‘+ Create invoice’ to bill the client."
        />
      ) : (
        <>
          <Table head={["Number", "Issued", "Client / Deal", "Amount", "Paid", "Due", "Status"]}>
            {invoices.map((inv) => {
              const paid = inv.payments.reduce((s, p) => s + toNumber(p.amount), 0);
              const overdue =
                inv.status === "ISSUED" && inv.dueDate && inv.dueDate < now;
              return (
                <tr key={inv.id} className="hover:bg-line-soft">
                  <Td>
                    <Link
                      href={`/invoices/${inv.id}`}
                      className="font-semibold text-ink hover:text-accent"
                      data-keep-latin
                    >
                      {inv.number}
                    </Link>
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-muted">{fmtDate(inv.issuedAt)}</Td>
                  <Td className="max-w-[220px] truncate">
                    {inv.client?.name ?? inv.deal?.client?.name ?? "—"}
                    {inv.deal && (
                      <div className="text-xs text-muted" data-keep-latin>{inv.deal.reference}</div>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap font-medium">{money(inv.amount)}</Td>
                  <Td className="whitespace-nowrap text-xs">
                    {paid > 0 ? <span className="text-ok">{money(paid)}</span> : <span className="text-muted">—</span>}
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-muted">{fmtDate(inv.dueDate)}</Td>
                  <Td>
                    {overdue ? <Badge tone="danger">Overdue</Badge> : <StatusBadge status={inv.status} />}
                  </Td>
                </tr>
              );
            })}
          </Table>
          <Pagination total={total} page={page} pageSize={pageSize} />
        </>
      )}
    </div>
  );
}
