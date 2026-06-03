import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { money, fmtDate, fmtDateTime, humanize } from "@/lib/format";
import { Brand } from "@/components/ui/Brand";
import { PrintButton } from "@/components/PrintButton";

/** Standalone, print-friendly payment receipt (browser → Save as PDF). */
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!user.companyId) notFound();

  const payment = await prisma.payment.findFirst({
    where: { id, companyId: user.companyId },
    include: {
      company: true,
      deal: { include: { client: true, property: true } },
    },
  });
  if (!payment) notFound();

  const receiptNo = payment.receiptNo ?? `RCPT-${payment.id.slice(-8).toUpperCase()}`;
  const issued = payment.paidAt ?? payment.createdAt;

  return (
    <div className="min-h-screen bg-canvas px-4 py-8 print:bg-white print:p-0">
      <div className="mx-auto max-w-2xl">
        <div className="mb-4 flex items-center justify-between print:hidden">
          <Link href={payment.dealId ? `/deals/${payment.dealId}` : "/payments"} className="text-sm text-muted hover:text-ink">← Back</Link>
          <PrintButton />
        </div>

        <div className="rounded-lg border border-line bg-white p-10 print:border-0 print:p-0">
          {/* Header */}
          <div className="flex items-start justify-between border-b border-line pb-6">
            <div>
              <Brand />
              <p className="mt-2 text-sm font-medium text-ink">{payment.company.name}</p>
            </div>
            <div className="text-right">
              <h1 className="text-xl font-semibold tracking-tight text-ink">Payment Receipt</h1>
              <p className="mt-1 text-sm text-muted">{receiptNo}</p>
              <p className="text-sm text-muted">{fmtDate(issued)}</p>
            </div>
          </div>

          {/* Parties */}
          <div className="grid gap-6 py-6 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Received from</p>
              <p className="mt-1 text-sm font-medium text-ink">{payment.deal?.client?.name ?? "—"}</p>
              {payment.deal?.client?.phone && <p className="text-sm text-muted">{payment.deal.client.phone}</p>}
            </div>
            <div className="sm:text-right">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Reference</p>
              <p className="mt-1 text-sm font-medium text-ink">{payment.deal?.reference ?? "—"}</p>
              {payment.deal?.property && <p className="text-sm text-muted">{payment.deal.property.title}</p>}
            </div>
          </div>

          {/* Line item */}
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-y border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-2 font-medium">Description</th>
                <th className="py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-line-soft">
                <td className="py-3">
                  <span className="font-medium text-ink">{humanize(payment.type)} payment</span>
                  {payment.method && <span className="block text-xs text-muted">via {payment.method}</span>}
                </td>
                <td className="py-3 text-right font-medium text-ink">{money(payment.amount)}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td className="py-3 text-right text-sm font-medium text-muted">Total paid</td>
                <td className="py-3 text-right text-lg font-semibold text-ink">{money(payment.amount)}</td>
              </tr>
            </tfoot>
          </table>

          {/* Footer — receipt-specific note above the status/timestamp row. */}
          {payment.company.receiptFooter && (
            <p className="mt-6 border-t border-line pt-4 text-xs text-muted">
              {payment.company.receiptFooter}
            </p>
          )}
          <div className={`flex items-end justify-between ${payment.company.receiptFooter ? "mt-3" : "mt-6 border-t border-line pt-6"}`}>
            <div>
              <p className="text-xs text-muted">Status</p>
              <p className="text-sm font-medium text-ink">{humanize(payment.status)}</p>
            </div>
            <p className="text-xs text-muted">Generated {fmtDateTime(new Date())}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
