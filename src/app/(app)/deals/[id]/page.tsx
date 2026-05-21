import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireCompanyUser } from "@/lib/session";
import { dealScope } from "@/lib/scope";
import { can } from "@/lib/rbac";
import { money, compactMoney, humanize, fmtDate, toNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { StatusBadge } from "@/components/ui/Badge";
import { DealStatusChanger, GenerateCommissionForm, RecordPaymentForm } from "@/components/deal/DealControls";
import { markPaymentPaid } from "@/app/(app)/payments/actions";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between border-b border-line-soft py-2 text-sm last:border-0">
      <span className="text-muted">{label}</span>
      <span className="font-medium text-ink">{value}</span>
    </div>
  );
}

export default async function DealDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireCompanyUser();
  const scope = await dealScope(user);

  const deal = await prisma.deal.findFirst({
    where: { id, ...scope },
    include: {
      property: true,
      client: true,
      dealer: true,
      sale: true,
      rental: true,
      agents: { include: { agent: true } },
      payments: { orderBy: { createdAt: "asc" } },
      commission: { include: { shares: true } },
      documents: true,
    },
  });
  if (!deal) notFound();

  const value = toNumber(deal.sale?.salePrice ?? deal.rental?.monthlyRent);
  const paid = deal.payments.filter((p) => p.status === "PAID").reduce((s, p) => s + toNumber(p.amount), 0);
  const office = can(user.role, "recordDeals");
  const suggestedComm = Math.round(value * 0.02);

  return (
    <div>
      <PageHeader
        eyebrow={`${humanize(deal.type)} · ${deal.reference}`}
        title={deal.property.title}
        subtitle={deal.client ? `Client: ${deal.client.name}` : undefined}
        action={<StatusBadge status={deal.status} />}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Section title="Money">
            {deal.type === "SALE" ? (
              <>
                <Row label="Sale price" value={money(deal.sale?.salePrice)} />
                <Row label="Token" value={deal.sale?.tokenAmount ? money(deal.sale.tokenAmount) : "—"} />
                <Row label="Booking" value={deal.sale?.bookingAmount ? money(deal.sale.bookingAmount) : "—"} />
                <Row label="Down payment" value={deal.sale?.downPayment ? money(deal.sale.downPayment) : "—"} />
              </>
            ) : (
              <>
                <Row label="Monthly rent" value={money(deal.rental?.monthlyRent)} />
                <Row label="Deposit" value={deal.rental?.deposit ? money(deal.rental.deposit) : "—"} />
                <Row label="Lease" value={deal.rental?.leaseMonths ? `${deal.rental.leaseMonths} months` : "—"} />
                <Row label="Renewal" value={fmtDate(deal.rental?.renewalDate)} />
              </>
            )}
            <Row label="Collected so far" value={<span className="text-ok">{money(paid)}</span>} />
          </Section>

          <Section
            title="Payments"
            action={office ? <span className="text-xs text-muted">{deal.payments.length} records</span> : null}
          >
            {deal.payments.length === 0 ? (
              <p className="mb-3 text-sm text-muted">No payments recorded.</p>
            ) : (
              <ul className="mb-3 divide-y divide-line">
                {deal.payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between py-2 text-sm">
                    <div>
                      <span className="font-medium text-ink">{humanize(p.type)}</span>
                      <span className="ml-2 text-muted">{money(p.amount)}</span>
                      {p.dueDate && p.status !== "PAID" && <span className="ml-2 text-xs text-muted">due {fmtDate(p.dueDate)}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={p.status} />
                      {p.status === "PAID" ? (
                        <a href={`/receipts/${p.id}`} target="_blank" rel="noopener noreferrer" className="btn-ghost px-2 py-1 text-xs">Receipt</a>
                      ) : office ? (
                        <form action={markPaymentPaid}>
                          <input type="hidden" name="id" value={p.id} />
                          <button className="btn-ghost px-2 py-1 text-xs">Mark paid</button>
                        </form>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {office && <RecordPaymentForm dealId={deal.id} isRental={deal.type === "RENTAL"} />}
          </Section>

          <Section title="Commission">
            {deal.commission ? (
              <>
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm text-muted">Total commission</span>
                  <span className="text-lg font-extrabold text-ink">{money(deal.commission.totalAmount)}</span>
                </div>
                <ul className="divide-y divide-line">
                  {deal.commission.shares.map((s) => (
                    <li key={s.id} className="flex items-center justify-between py-2 text-sm">
                      <div>
                        <span className="font-medium text-ink">{s.label}</span>
                        <span className="ml-2 text-xs text-muted">{toNumber(s.pct)}%</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{money(s.amount)}</span>
                        <StatusBadge status={s.paid ? "PAID" : "PENDING"} />
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="mt-3">
                  <Link href={`/commissions/${deal.commission.id}`} className="text-xs font-semibold text-accent">Manage commission →</Link>
                </div>
              </>
            ) : office && deal.status === "CLOSED_WON" ? (
              <GenerateCommissionForm dealId={deal.id} suggested={suggestedComm} />
            ) : (
              <p className="text-sm text-muted">Commission is generated once the deal is closed-won.</p>
            )}
          </Section>
        </div>

        <div className="space-y-6">
          {office && (
            <Section title="Deal status">
              <DealStatusChanger id={deal.id} current={deal.status} />
            </Section>
          )}

          <Section title="People">
            <Row label="Property" value={<Link href={`/properties/${deal.property.id}`} className="text-accent">{deal.property.reference}</Link>} />
            <Row label="Client" value={deal.client?.name ?? "—"} />
            <Row label="Dealer" value={deal.dealer ? <Link href={`/dealers/${deal.dealer.id}`} className="text-accent">{deal.dealer.name}</Link> : "—"} />
            <div className="pt-2">
              <p className="mb-1 text-xs font-semibold uppercase text-muted">Agents</p>
              <ul className="space-y-1">
                {deal.agents.map((a) => (
                  <li key={a.agentId} className="flex justify-between text-sm">
                    <span className="text-ink">{a.agent.name}</span>
                    <span className="text-xs text-muted">{humanize(a.role)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Section>

          <Section title="Documents">
            {deal.documents.length === 0 ? (
              <p className="text-sm text-muted">No documents attached.</p>
            ) : (
              <ul className="space-y-1">
                {deal.documents.map((d) => (
                  <li key={d.id} className="flex items-center justify-between text-sm">
                    <span className="truncate text-ink">{d.name}</span>
                    <StatusBadge status={d.verification} />
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <div className="surface p-4 text-center">
            <p className="text-xs uppercase text-muted">Deal value</p>
            <p className="text-2xl font-extrabold text-ink">{compactMoney(value)}{deal.type === "RENTAL" ? "/mo" : ""}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
