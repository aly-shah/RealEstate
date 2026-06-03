import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/session";
import { money, fmtDate, fmtDateTime, humanize, toNumber } from "@/lib/format";
import { Brand } from "@/components/ui/Brand";
import { StatusBadge, Badge } from "@/components/ui/Badge";
import { PrintButton } from "@/components/PrintButton";
import { cancelInvoice } from "../actions";

/**
 * Standalone, print-friendly invoice page (mirrors /receipts/[id]). The
 * surrounding chrome is `print:hidden` so "Print / Save as PDF" produces a
 * clean A4 with just the invoice card.
 */
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireCapability("managePayments");
  const companyId = user.companyId!;

  const invoice = await prisma.invoice.findFirst({
    where: { id, companyId },
    include: {
      company: true,
      client: true,
      deal: { include: { client: true, property: { select: { reference: true, title: true } } } },
      payments: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!invoice) notFound();

  const paid = invoice.payments
    .filter((p) => p.status === "PAID")
    .reduce((s, p) => s + toNumber(p.amount), 0);
  const total = toNumber(invoice.amount);
  const balance = Math.max(0, total - paid);
  const now = new Date();
  const overdue =
    invoice.status === "ISSUED" && invoice.dueDate && invoice.dueDate < now;
  const partyName = invoice.client?.name ?? invoice.deal?.client?.name ?? "—";
  const partyPhone = invoice.client?.phone ?? invoice.deal?.client?.phone ?? null;
  const partyEmail = invoice.client?.email ?? invoice.deal?.client?.email ?? null;

  return (
    <div className="min-h-screen bg-canvas px-4 py-8 print:bg-white print:p-0">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex items-center justify-between print:hidden">
          <Link href="/invoices" className="text-sm text-muted hover:text-ink">← Invoices</Link>
          <div className="flex items-center gap-2">
            {invoice.status !== "CANCELLED" && invoice.status !== "PAID" && (
              <form action={cancelInvoice}>
                <input type="hidden" name="id" value={invoice.id} />
                <button className="btn-ghost text-sm">Void invoice</button>
              </form>
            )}
            <PrintButton />
          </div>
        </div>

        <div className="rounded-lg border border-line bg-white p-10 print:border-0 print:p-0">
          {/* Header */}
          <div className="flex items-start justify-between border-b border-line pb-6">
            <div>
              <Brand />
              <p className="mt-2 text-sm font-medium text-ink">{invoice.company.name}</p>
              <p className="text-xs text-muted">Issued {fmtDate(invoice.issuedAt)}</p>
            </div>
            <div className="text-right">
              <h1 className="text-xl font-semibold tracking-tight text-ink">Invoice</h1>
              <p className="mt-1 text-sm font-medium text-ink" data-keep-latin>{invoice.number}</p>
              <div className="mt-2 flex items-center justify-end">
                {overdue ? <Badge tone="danger">Overdue</Badge> : <StatusBadge status={invoice.status} />}
              </div>
            </div>
          </div>

          {/* Parties + dates */}
          <div className="grid gap-6 py-6 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Bill to</p>
              <p className="mt-1 text-sm font-medium text-ink">{partyName}</p>
              {partyPhone && <p className="text-sm text-muted" data-keep-latin>{partyPhone}</p>}
              {partyEmail && <p className="text-sm text-muted" data-keep-latin>{partyEmail}</p>}
            </div>
            <div className="sm:text-right">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Reference</p>
              <p className="mt-1 text-sm font-medium text-ink" data-keep-latin>
                {invoice.deal?.reference ?? "—"}
              </p>
              {invoice.deal?.property && (
                <p className="text-sm text-muted">{invoice.deal.property.title}</p>
              )}
              {invoice.dueDate && (
                <p className="mt-2 text-xs text-muted">
                  Due <span className={overdue ? "text-danger font-medium" : ""}>{fmtDate(invoice.dueDate)}</span>
                </p>
              )}
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
                  <span className="font-medium text-ink">
                    {invoice.description ??
                      (invoice.deal ? `${invoice.deal.property.title} (${invoice.deal.reference})` : "Service")}
                  </span>
                </td>
                <td className="py-3 text-right font-medium text-ink">{money(invoice.amount)}</td>
              </tr>
            </tbody>
          </table>

          {/* Totals */}
          <div className="mt-4 ms-auto w-full max-w-xs space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">Total</span>
              <span className="font-medium text-ink">{money(total)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Paid</span>
              <span className="text-ok">{money(paid)}</span>
            </div>
            <div className="flex justify-between border-t border-line pt-1.5">
              <span className="font-semibold text-ink">Balance due</span>
              <span className="font-bold text-ink">{money(balance)}</span>
            </div>
          </div>

          {/* Payments table */}
          {invoice.payments.length > 0 && (
            <div className="mt-8">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Linked payments</p>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-y border-line text-left text-xs uppercase tracking-wide text-muted">
                    <th className="py-2 font-medium">Type</th>
                    <th className="py-2 font-medium">Date</th>
                    <th className="py-2 font-medium">Method / Receipt</th>
                    <th className="py-2 text-right font-medium">Amount</th>
                    <th className="py-2 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.payments.map((p) => (
                    <tr key={p.id} className="border-b border-line-soft">
                      <td className="py-2 text-ink">{humanize(p.type)}</td>
                      <td className="py-2 text-xs text-muted">{fmtDate(p.paidAt ?? p.createdAt)}</td>
                      <td className="py-2 text-xs text-muted">
                        {p.method ?? "—"}
                        {p.receiptNo && (
                          <>
                            {" · "}
                            <span data-keep-latin>{p.receiptNo}</span>
                          </>
                        )}
                      </td>
                      <td className="py-2 text-right font-medium text-ink">{money(p.amount)}</td>
                      <td className="py-2 text-right text-xs">
                        <StatusBadge status={p.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Footer */}
          <div className="mt-8 flex items-end justify-between border-t border-line pt-6">
            <p className="text-xs text-muted">
              {/* Per-invoice footer wins (Phase 3); fall back to the tenant
                  default (Phase 8); ultimate fallback is the platform string. */}
              {invoice.footer ?? invoice.company.invoiceFooter ?? "Thank you for your business."}
            </p>
            <p className="text-xs text-muted">Generated {fmtDateTime(new Date())}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
