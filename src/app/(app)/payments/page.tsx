import { requireCapability } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { outstandingPayments } from "@/lib/metrics";
import { money, fmtDate, humanize } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Table, Td } from "@/components/ui/Table";
import { StatCard } from "@/components/ui/StatCard";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { PaymentForm } from "./PaymentForm";
import { markPaymentPaid } from "./actions";

export default async function PaymentsPage() {
  const user = await requireCapability("managePayments");
  const companyId = user.companyId!;
  const now = new Date();

  const [payments, deals, totals] = await Promise.all([
    prisma.payment.findMany({
      where: { companyId },
      include: { deal: { include: { client: true } } },
      orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
      take: 150,
    }),
    prisma.deal.findMany({ where: { companyId }, select: { id: true, reference: true }, orderBy: { createdAt: "desc" }, take: 200 }),
    outstandingPayments(companyId),
  ]);

  const collected = payments.filter((p) => p.status === "PAID").reduce((s, p) => s + Number(p.amount), 0);

  return (
    <div>
      <PageHeader eyebrow="Money" title="Payments & receipts" subtitle="What's come in, what's due, and what's overdue." />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Collected" value={money(collected)} tone="ink" />
        <StatCard label="Due" value={money(totals.due)} tone="accent" />
        <StatCard label="Overdue" value={money(totals.overdue)} />
      </div>

      <PaymentForm deals={deals} />

      {payments.length === 0 ? (
        <EmptyState title="No payments recorded" hint="Record token money, instalments, rent and more." />
      ) : (
        <Table head={["Type", "Deal", "Client", "Amount", "Due", "Status", ""]}>
          {payments.map((p) => {
            const overdue = p.status !== "PAID" && p.dueDate && p.dueDate < now;
            return (
              <tr key={p.id} className="hover:bg-line-soft">
                <Td className="font-medium text-ink">{humanize(p.type)}</Td>
                <Td className="text-xs">{p.deal?.reference ?? "—"}</Td>
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
      )}
    </div>
  );
}
