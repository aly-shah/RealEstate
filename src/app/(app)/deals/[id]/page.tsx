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
import {
  DealStatusChanger,
  GenerateCommissionForm,
  RecordPaymentForm,
  CreateInvoiceForm,
} from "@/components/deal/DealControls";
import { markPaymentPaid } from "@/app/(app)/payments/actions";
import {
  startRentalContract,
  updateDealForecast,
  toggleChecklistItem,
  addChecklistItem,
  deleteChecklistItem,
} from "@/app/(app)/deals/actions";
import { WhatsAppButton } from "@/components/whatsapp/WhatsAppButton";
import { TEMPLATES } from "@/lib/whatsapp";

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
      checklist: { orderBy: { order: "asc" } },
      // Only the fields the lease-verification panel renders — never pull the
      // raw CNIC numbers into the page.
      contract: { select: { id: true, status: true, landlordVerifiedAt: true, renterVerifiedAt: true } },
      invoices: {
        include: { payments: { where: { status: "PAID" }, select: { amount: true } } },
        orderBy: { issuedAt: "desc" },
      },
    },
  });
  if (!deal) notFound();

  // Company name + WhatsApp signature override drive the templates below.
  const company = await prisma.company.findUnique({
    where: { id: user.companyId },
    select: { name: true, whatsappSignature: true },
  });
  const mainAgent = deal.agents.find((a) => a.role === "MAIN")?.agent;

  const value = toNumber(deal.sale?.salePrice ?? deal.rental?.monthlyRent);
  const paid = deal.payments.filter((p) => p.status === "PAID").reduce((s, p) => s + toNumber(p.amount), 0);
  const office = can(user.role, "recordDeals");
  const suggestedComm = Math.round(value * 0.02);
  const now = new Date();
  const canBill = can(user.role, "managePayments");

  // Closing-checklist readiness — required items still pending block CLOSED_WON.
  const checklistDone = deal.checklist.filter((c) => c.done).length;
  const requiredPending = deal.checklist.filter((c) => c.required && !c.done).length;
  const isDealClosed = deal.status === "CLOSED_WON" || deal.status === "CLOSED_LOST";

  return (
    <div>
      <PageHeader
        eyebrow={`${humanize(deal.type)} · ${deal.reference}`}
        title={deal.property.title}
        subtitle={deal.client ? `Client: ${deal.client.name}` : undefined}
        action={<StatusBadge status={deal.status} />}
      />

      {deal.status === "CLOSED_LOST" && deal.lostReason && (
        <p className="mb-4 rounded-xl border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger">
          <span className="font-semibold">Lost:</span> {deal.lostReason}
        </p>
      )}

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
                {deal.payments.map((p) => {
                  // Auto-classify overdue at render time so the badge updates
                  // without needing a background job to flip the stored status.
                  const isOverdue = p.status !== "PAID" && !!p.dueDate && p.dueDate < now;
                  return (
                    <li key={p.id} className="flex items-center justify-between py-2 text-sm">
                      <div>
                        <span className="font-medium text-ink">{humanize(p.type)}</span>
                        <span className="ml-2 text-muted">{money(p.amount)}</span>
                        {p.dueDate && p.status !== "PAID" && (
                          <span className={`ml-2 text-xs ${isOverdue ? "text-danger font-medium" : "text-muted"}`}>
                            due {fmtDate(p.dueDate)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {isOverdue ? <StatusBadge status="OVERDUE" /> : <StatusBadge status={p.status} />}
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
                  );
                })}
              </ul>
            )}
            {office && <RecordPaymentForm dealId={deal.id} isRental={deal.type === "RENTAL"} />}
          </Section>

          <Section
            title="Invoices"
            action={canBill ? <span className="text-xs text-muted">{deal.invoices.length} on file</span> : null}
          >
            {deal.invoices.length === 0 ? (
              <p className="mb-3 text-sm text-muted">No invoices issued yet.</p>
            ) : (
              <ul className="mb-3 divide-y divide-line">
                {deal.invoices.map((inv) => {
                  const invPaid = inv.payments.reduce((s, p) => s + toNumber(p.amount), 0);
                  const balance = Math.max(0, toNumber(inv.amount) - invPaid);
                  const isOverdue =
                    inv.status === "ISSUED" && !!inv.dueDate && inv.dueDate < now;
                  return (
                    <li key={inv.id} className="flex items-center justify-between py-2 text-sm">
                      <div>
                        <a
                          href={`/invoices/${inv.id}`}
                          className="font-medium text-ink hover:text-accent"
                          data-keep-latin
                        >
                          {inv.number}
                        </a>
                        <span className="ml-2 text-muted">{money(inv.amount)}</span>
                        {balance > 0 && inv.status === "ISSUED" && (
                          <span className="ml-2 text-xs text-muted">balance {money(balance)}</span>
                        )}
                      </div>
                      {isOverdue ? <StatusBadge status="OVERDUE" /> : <StatusBadge status={inv.status} />}
                    </li>
                  );
                })}
              </ul>
            )}
            {canBill && <CreateInvoiceForm dealId={deal.id} suggestedAmount={value} />}
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

          {office && (
            <Section
              title="Closing checklist"
              action={
                <span className="text-xs text-muted">{checklistDone}/{deal.checklist.length} done</span>
              }
            >
              {!isDealClosed && requiredPending > 0 && (
                <p className="mb-3 rounded-xl border border-warn/30 bg-warn-bg px-3 py-2 text-xs text-warn">
                  {requiredPending} required item{requiredPending === 1 ? "" : "s"} pending — the deal can&rsquo;t be closed-won until these are done.
                </p>
              )}
              {!isDealClosed && deal.checklist.length > 0 && requiredPending === 0 && (
                <p className="mb-3 rounded-xl border border-ok/30 bg-ok-bg px-3 py-2 text-xs text-ok">
                  All required items complete — ready to close.
                </p>
              )}
              {deal.checklist.length === 0 ? (
                <p className="mb-3 text-sm text-muted">No checklist items.</p>
              ) : (
                <ul className="mb-3 divide-y divide-line">
                  {deal.checklist.map((item) => (
                    <li key={item.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <form action={toggleChecklistItem} className="flex min-w-0 items-center gap-2">
                        <input type="hidden" name="id" value={item.id} />
                        <button
                          type="submit"
                          aria-label={item.done ? "Mark not done" : "Mark done"}
                          className={`grid h-5 w-5 shrink-0 place-items-center rounded border text-xs ${
                            item.done ? "border-ok bg-ok text-white" : "border-line bg-paper text-transparent hover:border-accent"
                          }`}
                        >
                          ✓
                        </button>
                        <span className={`truncate ${item.done ? "text-muted line-through" : "text-ink"}`}>
                          {item.label}
                          {item.required && <span className="ml-1 text-xs text-danger">*</span>}
                        </span>
                      </form>
                      <form action={deleteChecklistItem}>
                        <input type="hidden" name="id" value={item.id} />
                        <button className="btn-ghost px-2 py-0.5 text-xs text-muted" aria-label="Remove item">✕</button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
              <form action={addChecklistItem} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="dealId" value={deal.id} />
                <input name="label" className="field flex-1 min-w-[12rem]" placeholder="Add an item…" required />
                <label className="flex items-center gap-1 text-xs text-muted">
                  <input type="checkbox" name="required" defaultChecked className="accent-ink" /> Required
                </label>
                <button className="btn-ghost text-xs">+ Add</button>
              </form>
              <p className="mt-2 text-xs text-muted"><span className="text-danger">*</span> required to close. Items are checked off manually.</p>
            </Section>
          )}
        </div>

        <div className="space-y-6 right-rail">
          {office && (
            <Section title="Deal status">
              <DealStatusChanger id={deal.id} current={deal.status} />
            </Section>
          )}

          {office && (
            <Section title="Forecast & GCI">
              <form action={updateDealForecast} className="space-y-3">
                <input type="hidden" name="id" value={deal.id} />
                <div>
                  <label className="label" htmlFor="grossCommissionPercentage">Gross commission %</label>
                  <input
                    id="grossCommissionPercentage"
                    name="grossCommissionPercentage"
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    className="field"
                    defaultValue={toNumber(deal.grossCommissionPercentage) || ""}
                  />
                  <p className="mt-1 text-xs text-muted">% of the deal value — drives the GCI &amp; forecast reports.</p>
                </div>
                <div>
                  <label className="label" htmlFor="estimatedCloseDate">Estimated close date</label>
                  <input
                    id="estimatedCloseDate"
                    name="estimatedCloseDate"
                    type="date"
                    className="field"
                    defaultValue={deal.estimatedCloseDate ? deal.estimatedCloseDate.toISOString().slice(0, 10) : ""}
                  />
                </div>
                <button type="submit" className="btn-ghost w-full justify-center text-xs">Save</button>
              </form>
            </Section>
          )}

          {office && deal.type === "RENTAL" && (
            <Section title="Lease verification">
              {deal.contract ? (
                <>
                  <Row label="Status" value={<StatusBadge status={deal.contract.status} />} />
                  <Row
                    label="Landlord CNIC"
                    value={
                      deal.contract.landlordVerifiedAt
                        ? <span className="font-medium text-ok">Verified</span>
                        : <span className="text-muted">Awaiting</span>
                    }
                  />
                  <Row
                    label="Renter CNIC"
                    value={
                      deal.contract.renterVerifiedAt
                        ? <span className="font-medium text-ok">Verified</span>
                        : <span className="text-muted">Awaiting</span>
                    }
                  />
                  <form action={startRentalContract} className="mt-3">
                    <input type="hidden" name="dealId" value={deal.id} />
                    <button className="btn-ghost w-full justify-center text-xs">Resend CNIC links</button>
                  </form>
                </>
              ) : (
                <>
                  <p className="mb-3 text-sm text-muted">
                    Send the landlord and renter a secure WhatsApp link to photograph their CNIC for the lease agreement.
                  </p>
                  <form action={startRentalContract}>
                    <input type="hidden" name="dealId" value={deal.id} />
                    <button className="btn-accent w-full justify-center">Start CNIC verification</button>
                  </form>
                </>
              )}
            </Section>
          )}

          <Section title="People">
            <Row label="Property" value={<Link href={`/properties/${deal.property.id}`} className="text-accent">{deal.property.reference}</Link>} />
            <Row label="Client" value={deal.client?.name ?? "—"} />
            <Row label="Dealer" value={deal.dealer ? <Link href={`/dealers/${deal.dealer.id}`} className="text-accent">{deal.dealer.name}</Link> : "—"} />

            {/* Quick WhatsApp links — one per counterparty when they have a phone on file. */}
            {(deal.client?.phone || deal.dealer?.contact) && (
              <div className="mt-3 flex flex-wrap gap-2">
                {deal.client?.phone && (
                  <WhatsAppButton
                    phone={deal.client.phone}
                    label="WhatsApp client"
                    message={TEMPLATES.dealUpdate({
                      clientName: deal.client.name,
                      agentName: mainAgent?.name,
                      companyName: company?.name ?? "the team",
                      signature: company?.whatsappSignature,
                      dealRef: deal.reference,
                      stage: deal.status,
                    })}
                  />
                )}
                {deal.dealer?.contact && (
                  <WhatsAppButton
                    phone={deal.dealer.contact}
                    label="WhatsApp dealer"
                    message={TEMPLATES.dealUpdate({
                      clientName: deal.dealer.name,
                      agentName: mainAgent?.name,
                      companyName: company?.name ?? "the team",
                      signature: company?.whatsappSignature,
                      dealRef: deal.reference,
                      stage: deal.status,
                    })}
                  />
                )}
              </div>
            )}

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
