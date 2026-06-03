import { requireCapability } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { outstandingPayments } from "@/lib/metrics";
import { money, fmtDate, humanize } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Table, Td } from "@/components/ui/Table";
import { StatCard } from "@/components/ui/StatCard";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { parsePage } from "@/lib/pagination";
import { PaymentForm } from "./PaymentForm";
import { markPaymentPaid } from "./actions";

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; pageSize?: string }>;
}) {
  const user = await requireCapability("managePayments");
  const companyId = user.companyId!;
  const now = new Date();
  const sp = await searchParams;
  const { page, pageSize, skip } = parsePage(sp);

  const [payments, total, deals, openInvoices, totals, collectedAgg] = await Promise.all([
    prisma.payment.findMany({
      where: { companyId },
      include: { deal: { include: { client: true } }, invoice: { select: { number: true } } },
      orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
      skip,
      take: pageSize,
    }),
    prisma.payment.count({ where: { companyId } }),
    prisma.deal.findMany({ where: { companyId }, select: { id: true, reference: true }, orderBy: { createdAt: "desc" }, take: 200 }),
    // Picker shows ISSUED invoices only (drafts aren't billable; paid/cancelled are done).
    prisma.invoice.findMany({
      where: { companyId, status: "ISSUED" },
      select: { id: true, number: true, amount: true },
      orderBy: { issuedAt: "desc" },
      take: 200,
    }),
    outstandingPayments(companyId),
    // Aggregate across ALL paid rows so the KPI doesn't shrink with pagination.
    prisma.payment.aggregate({ where: { companyId, status: "PAID" }, _sum: { amount: true } }),
  ]);

  const collected = Number(collectedAgg._sum.amount ?? 0);
  const invoiceOptions = openInvoices.map((inv) => ({
    id: inv.id,
    number: inv.number,
    amount: money(inv.amount),
  }));

  return (
    <div>
      <PageHeader eyebrow="Money" title="Payments & receipts" subtitle="What's come in, what's due, and what's overdue." />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Collected" value={money(collected)} tone="ink" />
        <StatCard label="Due" value={money(totals.due)} tone="accent" />
        <StatCard label="Overdue" value={money(totals.overdue)} />
      </div>

      <PaymentForm deals={deals} invoices={invoiceOptions} />

      {payments.length === 0 ? (
        <EmptyState title="No payments recorded" hint="Record token money, instalments, rent and more." />
      ) : (
        <>
          <Table head={["Type", "Deal", "Invoice", "Client", "Amount", "Due", "Status", ""]}>
            {payments.map((p) => {
              const overdue = p.status !== "PAID" && p.dueDate && p.dueDate < now;
              return (
                <tr key={p.id} className="hover:bg-line-soft">
                  <Td className="font-medium text-ink">{humanize(p.type)}</Td>
                  <Td className="text-xs">{p.deal?.reference ?? "—"}</Td>
                  <Td className="text-xs" data-keep-latin>{p.invoice?.number ?? "—"}</Td>
                  <Td>{p.deal?.client?.name ?? "—"}</Td>
                  <Td className="font-medium">{money(p.amount)}</Td>
                  <Td className="text-xs text-muted">{fmtDate(p.dueDate)}</Td>
                  <Td>{overdue ? <Badge tone="danger">Overdue</Badge> : <StatusBadge status={p.status} />}</Td>
                  <Td>
                    {p.status === "PAID" ? (
                      <a href={`/receipts/${p.id}`} target="_blank" rel="noopener noreferrer" className="btn-ghost px-2 py-1 text-xs">Receipt</a>
                    ) : (
                      <form action={markPaymentPaid}>
                        <input type="hidden" name="id" value={p.id} />
                        <button className="btn-ghost px-2 py-1 text-xs">Mark paid</button>
                      </form>
                    )}
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
