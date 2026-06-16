import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { money, fmtDate, fmtDateTime, toNumber } from "@/lib/format";
import { Brand } from "@/components/ui/Brand";
import { PrintButton } from "@/components/PrintButton";
import { ALL_DEAL_DOC_KINDS, type DealDocKind } from "@/lib/deal-documents";
import { setDocumentOverride } from "@/app/(app)/deals/actions";

/**
 * Standalone, print-friendly deal document (browser → Save as PDF). One route
 * renders the agreement, the payment receipt, or the possession/handover note,
 * all filled from the deal's Contract — including the CNIC identities captured by
 * the verify links. Lives outside the (app) group so it prints without the app
 * chrome; still auth-gated (not a public path) + tenant-scoped.
 */
export default async function DealDocumentPage({
  params,
}: {
  params: Promise<{ id: string; doc: string }>;
}) {
  const { id, doc } = await params;
  if (!ALL_DEAL_DOC_KINDS.includes(doc as DealDocKind)) notFound();
  const kind = doc as DealDocKind;

  const user = await requireUser();
  // Office-only: these documents carry CNIC identities, like the deal's
  // contract panel — agents shouldn't reach them by guessing the URL.
  if (!user.companyId || !can(user.role, "recordDeals")) notFound();

  const deal = await prisma.deal.findFirst({
    where: { id, companyId: user.companyId },
    include: {
      company: true,
      property: true,
      client: true,
      sale: true,
      rental: true,
      contract: true,
      agents: { where: { role: "MAIN" }, include: { agent: true } },
    },
  });
  if (!deal) notFound();

  const c = deal.contract;
  const isSale = deal.type === "SALE";

  // Party A = seller/landlord (property owner), B = buyer/renter (the client).
  // Verified CNIC identities win; fall back to the deal records.
  const partyA = {
    role: isSale ? "Seller (First Party)" : "Landlord (First Party)",
    name: c?.landlordCnicName || deal.property.ownerName || "—",
    cnic: c?.landlordCnic || "____________—____________—_",
    phone: deal.property.ownerPhone || "—",
    verified: !!c?.landlordVerifiedAt,
  };
  const partyB = {
    role: isSale ? "Buyer (Second Party)" : "Tenant (Second Party)",
    name: c?.renterCnicName || deal.client?.name || "—",
    cnic: c?.renterCnic || "____________—____________—_",
    phone: deal.client?.phone || "—",
    verified: !!c?.renterVerifiedAt,
  };

  const t = {
    salePrice: c?.salePrice ?? deal.sale?.salePrice ?? null,
    tokenAmount: c?.tokenAmount ?? deal.sale?.tokenAmount ?? null,
    downPayment: c?.downPayment ?? deal.sale?.downPayment ?? null,
    monthlyRent: c?.monthlyRent ?? deal.rental?.monthlyRent ?? null,
    deposit: c?.deposit ?? deal.rental?.deposit ?? null,
    leaseMonths: c?.leaseMonths ?? deal.rental?.leaseMonths ?? null,
    startDate: c?.startDate ?? null,
    endDate: c?.endDate ?? null,
    possessionDate: c?.possessionDate ?? null,
    clauses: c?.customClauses ?? null,
  };

  // Per-document free-text override (append to, or replace, the standard body).
  const overrides = (c?.documentOverrides as Record<string, { mode?: string; text?: string }> | null) ?? {};
  const ov = overrides[kind];
  const ovText = typeof ov?.text === "string" ? ov.text.trim() : "";
  const ovMode = ov?.mode === "replace" ? "replace" : "append";
  const doReplace = ovMode === "replace" && ovText.length > 0;
  const doAppend = ovMode === "append" && ovText.length > 0;

  const propLine = [deal.property.address, deal.property.area, deal.property.city].filter(Boolean).join(", ");
  const TITLES: Record<DealDocKind, string> = {
    agreement: isSale ? "Agreement to Sell" : "Rental / Lease Agreement",
    "sale-deed": "Sale Deed (Transfer of Ownership)",
    "payment-plan": "Payment Schedule",
    receipt: isSale ? "Token / Booking Receipt" : "Security Deposit Receipt",
    possession: "Possession / Handover Note",
    noc: "No Objection Certificate (NOC)",
    affidavit: isSale ? "Affidavit of Ownership & Indemnity" : "Tenant Undertaking",
    "power-of-attorney": "Special Power of Attorney",
    "tax-certificate": "Tax / FBR Certificate",
  };
  const title = TITLES[kind];

  const backHref = `/deals/${deal.id}`;

  return (
    <div className="min-h-screen bg-canvas px-4 py-8 print:bg-white print:p-0">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex items-center justify-between print:hidden">
          <Link href={backHref} className="text-sm text-muted hover:text-ink">← Back to deal</Link>
          <PrintButton />
        </div>

        {/* Office-only inline editor — append to or replace this document's body. */}
        <section className="mb-4 rounded-xl border border-line bg-paper p-4 print:hidden">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Customize this document</h2>
            {ovText ? <span className="chip border-accent/25 bg-accent-wash text-accent">Custom text applied · {ovMode}</span> : null}
          </div>
          <form action={setDocumentOverride} className="space-y-3">
            <input type="hidden" name="dealId" value={deal.id} />
            <input type="hidden" name="kind" value={kind} />
            <div>
              <label className="label" htmlFor="mode">Mode</label>
              <select id="mode" name="mode" className="field" defaultValue={ovMode}>
                <option value="append">Append to the standard text</option>
                <option value="replace">Replace the standard body</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="text">Custom text</label>
              <textarea
                id="text"
                name="text"
                rows={8}
                className="field"
                defaultValue={ovText}
                placeholder="Type the additional clauses, or the full document text to replace the standard body…"
              />
            </div>
            <div className="flex items-center gap-3">
              <button type="submit" className="btn-primary">Save &amp; apply</button>
              <span className="text-xs text-muted">Clear the text and save to revert to the standard template.</span>
            </div>
          </form>
        </section>

        <article className="rounded-lg border border-line bg-white p-10 text-[13px] leading-relaxed text-ink print:border-0 print:p-0">
          {/* Letterhead */}
          <header className="flex items-start justify-between border-b border-line pb-5">
            <div>
              <Brand />
              <p className="mt-2 text-sm font-medium">{deal.company.name}</p>
            </div>
            <div className="text-right">
              <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
              <p className="mt-1 text-xs text-muted">Ref: {deal.reference}</p>
              <p className="text-xs text-muted">Dated: {fmtDate(t.possessionDate ?? new Date())}</p>
            </div>
          </header>

          {doReplace ? (
            <OverrideBody text={ovText} />
          ) : (
            <>
              {kind === "agreement" && (
                <AgreementBody isSale={isSale} partyA={partyA} partyB={partyB} t={t} property={deal.property} propLine={propLine} />
              )}
              {kind === "sale-deed" && (
                <SaleDeedBody partyA={partyA} partyB={partyB} t={t} property={deal.property} propLine={propLine} />
              )}
              {kind === "payment-plan" && (
                <PaymentPlanBody partyB={partyB} t={t} reference={deal.reference} propTitle={deal.property.title} />
              )}
              {kind === "receipt" && (
                <ReceiptBody isSale={isSale} partyA={partyA} partyB={partyB} t={t} reference={deal.reference} propTitle={deal.property.title} />
              )}
              {kind === "possession" && (
                <PossessionBody isSale={isSale} partyA={partyA} partyB={partyB} t={t} propTitle={deal.property.title} propLine={propLine} />
              )}
              {kind === "noc" && (
                <NocBody isSale={isSale} partyA={partyA} partyB={partyB} propTitle={deal.property.title} propLine={propLine} />
              )}
              {kind === "affidavit" && (
                <AffidavitBody isSale={isSale} partyA={partyA} partyB={partyB} propTitle={deal.property.title} propLine={propLine} />
              )}
              {kind === "power-of-attorney" && (
                <PowerOfAttorneyBody partyA={partyA} partyB={partyB} property={deal.property} propLine={propLine} />
              )}
              {kind === "tax-certificate" && (
                <TaxCertificateBody partyA={partyA} partyB={partyB} t={t} property={deal.property} propLine={propLine} />
              )}
              {doAppend && <OverrideSection text={ovText} />}
            </>
          )}

          <footer className="mt-8 border-t border-line pt-4 text-[11px] text-muted">
            <p>
              This document was generated by {deal.company.name} on {fmtDateTime(new Date())}. Identity details marked
              “verified” were captured via secure CNIC verification. This is a working draft for the parties&rsquo; review;
              it takes effect on signature.
            </p>
          </footer>
        </article>
      </div>
    </div>
  );
}

type Party = { role: string; name: string; cnic: string; phone: string; verified: boolean };
type Terms = {
  salePrice: unknown; tokenAmount: unknown; downPayment: unknown;
  monthlyRent: unknown; deposit: unknown; leaseMonths: number | null;
  startDate: Date | null; endDate: Date | null; possessionDate: Date | null; clauses: string | null;
};

function PartyCard({ p }: { p: Party }) {
  return (
    <div className="rounded-md border border-line-soft p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{p.role}</p>
      <p className="mt-1 font-medium">{p.name}</p>
      <p className="text-muted">
        CNIC: {p.cnic}
        {p.verified && <span className="ml-2 font-medium text-ok">✓ verified</span>}
      </p>
      <p className="text-muted">Phone: {p.phone}</p>
    </div>
  );
}

function Clause({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="mb-1.5">
      <span className="font-medium">{n}.</span> {children}
    </li>
  );
}

function SignatoryLine({ p }: { p: Party }) {
  return (
    <div>
      <div className="mt-12 border-t border-ink/60" />
      <p className="mt-1 font-medium">{p.name}</p>
      <p className="text-[11px] text-muted">{p.role} · CNIC {p.cnic}</p>
    </div>
  );
}

function SignatureBlock({ partyA, partyB }: { partyA: Party; partyB: Party }) {
  return (
    <section className="mt-8 break-inside-avoid">
      <div className="grid grid-cols-2 gap-10">
        <SignatoryLine p={partyA} />
        <SignatoryLine p={partyB} />
      </div>
      <div className="mt-8 grid grid-cols-2 gap-10">
        <div>
          <div className="mt-10 border-t border-ink/60" />
          <p className="mt-1 text-[11px] text-muted">Witness 1 — Name, CNIC &amp; Signature</p>
        </div>
        <div>
          <div className="mt-10 border-t border-ink/60" />
          <p className="mt-1 text-[11px] text-muted">Witness 2 — Name, CNIC &amp; Signature</p>
        </div>
      </div>
    </section>
  );
}

function AgreementBody({
  isSale, partyA, partyB, t, property, propLine,
}: {
  isSale: boolean; partyA: Party; partyB: Party; t: Terms;
  property: { title: string; reference: string }; propLine: string;
}) {
  const balance =
    t.salePrice != null
      ? toNumber(t.salePrice as never) - toNumber((t.tokenAmount ?? 0) as never) - toNumber((t.downPayment ?? 0) as never)
      : 0;
  return (
    <div className="py-6">
      <p className="mb-5">
        This {isSale ? "Agreement to Sell" : "Lease Agreement"} is made between the parties named below for the property
        described herein, on the terms that follow.
      </p>

      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <PartyCard p={partyA} />
        <PartyCard p={partyB} />
      </div>

      <div className="mb-5 rounded-md border border-line-soft p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Property</p>
        <p className="mt-1 font-medium">{property.title}</p>
        {propLine && <p className="text-muted">{propLine}</p>}
        <p className="text-muted">Ref: {property.reference}</p>
      </div>

      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Terms</p>
      <table className="mb-5 w-full border-collapse">
        <tbody>
          {isSale ? (
            <>
              <TermRow label="Total sale price" value={t.salePrice != null ? money(t.salePrice as never) : "—"} />
              {t.tokenAmount != null && <TermRow label="Token / bayana paid" value={money(t.tokenAmount as never)} />}
              {t.downPayment != null && <TermRow label="Down payment" value={money(t.downPayment as never)} />}
              {t.salePrice != null && <TermRow label="Balance payable" value={money(balance as never)} />}
              {t.possessionDate && <TermRow label="Possession date" value={fmtDate(t.possessionDate)} />}
            </>
          ) : (
            <>
              <TermRow label="Monthly rent" value={t.monthlyRent != null ? money(t.monthlyRent as never) : "—"} />
              {t.deposit != null && <TermRow label="Security deposit" value={money(t.deposit as never)} />}
              {t.leaseMonths != null && <TermRow label="Lease term" value={`${t.leaseMonths} months`} />}
              {t.startDate && <TermRow label="Start date" value={fmtDate(t.startDate)} />}
              {t.endDate && <TermRow label="End date" value={fmtDate(t.endDate)} />}
            </>
          )}
        </tbody>
      </table>

      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Terms &amp; conditions</p>
      <ol className="mb-2 pl-1">
        {isSale ? (
          <>
            <Clause n={1}>The Seller agrees to sell and the Buyer agrees to purchase the property described above at the total price stated.</Clause>
            <Clause n={2}>The token / bayana amount is paid as earnest money and adjusted against the total sale price.</Clause>
            <Clause n={3}>The balance shall be paid at the time of transfer / registry, against which vacant possession is handed over.</Clause>
            <Clause n={4}>All government taxes, transfer fees and utility dues up to the date of transfer are settled as agreed between the parties.</Clause>
            <Clause n={5}>Should the Buyer default, the token may be forfeited; should the Seller default, the token shall be returned, subject to mutual settlement.</Clause>
          </>
        ) : (
          <>
            <Clause n={1}>The Landlord lets and the Tenant takes the property on rent for the term stated above.</Clause>
            <Clause n={2}>Rent is payable monthly in advance; the security deposit is refundable at the end of the term less any lawful deductions.</Clause>
            <Clause n={3}>Utility bills and routine maintenance during the tenancy are borne by the Tenant unless agreed otherwise.</Clause>
            <Clause n={4}>The Tenant shall not sublet or structurally alter the property without the Landlord&rsquo;s written consent.</Clause>
            <Clause n={5}>Either party may terminate by serving the agreed notice; the property is returned in its original condition.</Clause>
          </>
        )}
      </ol>
      {t.clauses && (
        <div className="mb-2">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Special clauses</p>
          <p className="whitespace-pre-wrap">{t.clauses}</p>
        </div>
      )}

      <SignatureBlock partyA={partyA} partyB={partyB} />
    </div>
  );
}

function TermRow({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-b border-line-soft">
      <td className="py-2 text-muted">{label}</td>
      <td className="py-2 text-right font-medium">{value}</td>
    </tr>
  );
}

function ReceiptBody({
  isSale, partyA, partyB, t, reference, propTitle,
}: {
  isSale: boolean; partyA: Party; partyB: Party; t: Terms; reference: string; propTitle: string;
}) {
  const amount = isSale ? (t.tokenAmount ?? t.downPayment) : t.deposit;
  const purpose = isSale ? "token / booking amount" : "security deposit";
  return (
    <div className="py-6">
      <p className="mb-6">
        Received with thanks from <span className="font-medium">{partyB.name}</span> the sum of{" "}
        <span className="font-medium">{amount != null ? money(amount as never) : "—"}</span> towards the {purpose} for the
        property <span className="font-medium">{propTitle}</span> (Ref: {reference}).
      </p>
      <table className="mb-6 w-full border-collapse">
        <tbody>
          <TermRow label="Received from" value={partyB.name} />
          <TermRow label="Amount" value={amount != null ? money(amount as never) : "—"} />
          <TermRow label="Towards" value={isSale ? "Token / Booking" : "Security Deposit"} />
          <TermRow label="Property" value={propTitle} />
          <TermRow label="Reference" value={reference} />
        </tbody>
      </table>
      <div className="mt-12 grid grid-cols-2 gap-10">
        <div />
        <div>
          <div className="mt-10 border-t border-ink/60" />
          <p className="mt-1 font-medium">{partyA.name}</p>
          <p className="text-[11px] text-muted">Received by ({partyA.role})</p>
        </div>
      </div>
    </div>
  );
}

function PossessionBody({
  isSale, partyA, partyB, t, propTitle, propLine,
}: {
  isSale: boolean; partyA: Party; partyB: Party; t: Terms; propTitle: string; propLine: string;
}) {
  const recipient = isSale ? "Buyer" : "Tenant";
  return (
    <div className="py-6">
      <p className="mb-5">
        This note confirms that vacant physical possession of the property described below has been handed over by{" "}
        <span className="font-medium">{partyA.name}</span> to <span className="font-medium">{partyB.name}</span> ({recipient})
        {t.possessionDate ? <> on <span className="font-medium">{fmtDate(t.possessionDate)}</span></> : null}.
      </p>
      <div className="mb-5 rounded-md border border-line-soft p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Property</p>
        <p className="mt-1 font-medium">{propTitle}</p>
        {propLine && <p className="text-muted">{propLine}</p>}
      </div>
      <ol className="mb-2 pl-1">
        <Clause n={1}>The {recipient} acknowledges receiving possession in acceptable condition, with keys and access handed over.</Clause>
        <Clause n={2}>Meter readings and utility accounts are recorded as of the possession date.</Clause>
        <Clause n={3}>Any pending items noted by the parties are listed in the special clauses / annexure.</Clause>
      </ol>
      {t.clauses && <p className="mb-2 whitespace-pre-wrap">{t.clauses}</p>}
      <SignatureBlock partyA={partyA} partyB={partyB} />
    </div>
  );
}

/** Full free-text body (replace mode). */
function OverrideBody({ text }: { text: string }) {
  return <div className="whitespace-pre-wrap py-6">{text}</div>;
}

/** Extra free-text appended below the standard body (append mode). */
function OverrideSection({ text }: { text: string }) {
  return (
    <section className="mt-2 break-inside-avoid">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Additional terms</p>
      <p className="whitespace-pre-wrap">{text}</p>
    </section>
  );
}

function PropertyBlock({ title, line }: { title: string; line: string }) {
  return (
    <div className="mb-5 rounded-md border border-line-soft p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Property</p>
      <p className="mt-1 font-medium">{title}</p>
      {line && <p className="text-muted">{line}</p>}
    </div>
  );
}

function SaleDeedBody({
  partyA, partyB, t, property, propLine,
}: {
  partyA: Party; partyB: Party; t: Terms; property: { title: string; reference: string }; propLine: string;
}) {
  const price = t.salePrice != null ? money(t.salePrice as never) : "the agreed consideration";
  return (
    <div className="py-6">
      <p className="mb-5">
        This Sale Deed is executed on the date above between the Seller (First Party) and the Buyer (Second Party) named
        below, transferring absolute ownership of the property described herein.
      </p>
      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <PartyCard p={partyA} />
        <PartyCard p={partyB} />
      </div>
      <PropertyBlock title={property.title} line={[propLine, `Ref: ${property.reference}`].filter(Boolean).join(" · ")} />

      <p className="mb-3">
        WHEREAS the Seller is the lawful and absolute owner in peaceful possession of the said property, free from all
        encumbrances, mortgages, charges, liens, litigation and disputes; AND WHEREAS the Seller has agreed to sell and
        the Buyer has agreed to purchase the said property for a total consideration of {price}.
      </p>
      <p className="mb-4">
        NOW THIS DEED WITNESSES that in consideration of the said sum, the receipt of which the Seller acknowledges, the
        Seller hereby sells, transfers and conveys unto the Buyer all rights, title and interest in the said property, to
        have and to hold the same absolutely and forever.
      </p>
      <ol className="mb-2 pl-1">
        <Clause n={1}>The Seller has delivered / shall deliver vacant physical possession of the property to the Buyer.</Clause>
        <Clause n={2}>The Seller warrants clear and marketable title and shall indemnify the Buyer against any third-party claim.</Clause>
        <Clause n={3}>All taxes, utility dues and society charges up to the date of transfer are cleared by the Seller.</Clause>
        <Clause n={4}>Transfer / registration costs shall be borne as agreed between the parties.</Clause>
        <Clause n={5}>This transfer shall be duly recorded with the relevant authority / housing society / sub-registrar.</Clause>
      </ol>
      {t.clauses && <p className="mb-2 whitespace-pre-wrap">{t.clauses}</p>}
      <SignatureBlock partyA={partyA} partyB={partyB} />
    </div>
  );
}

function PaymentPlanBody({
  partyB, t, reference, propTitle,
}: {
  partyB: Party; t: Terms; reference: string; propTitle: string;
}) {
  const total = toNumber(t.salePrice as never);
  const token = toNumber((t.tokenAmount ?? 0) as never);
  const down = toNumber((t.downPayment ?? 0) as never);
  const balance = Math.max(0, total - token - down);
  const rows = [
    { stage: "Token / Bayana", when: "On booking", amount: token, status: "Paid" },
    { stage: "Down payment", when: "On signing the agreement", amount: down, status: "Due" },
    { stage: "Balance on transfer", when: "At transfer & possession", amount: balance, status: "Due" },
  ];
  return (
    <div className="py-6">
      <p className="mb-5">
        Payment schedule for <span className="font-medium">{partyB.name}</span> against the purchase of{" "}
        <span className="font-medium">{propTitle}</span> (Ref: {reference}).
      </p>
      <table className="mb-4 w-full border-collapse text-sm">
        <thead>
          <tr className="border-y border-line text-left text-xs uppercase tracking-wide text-muted">
            <th className="py-2 font-medium">Stage</th>
            <th className="py-2 font-medium">Milestone</th>
            <th className="py-2 text-right font-medium">Amount</th>
            <th className="py-2 text-right font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.stage} className="border-b border-line-soft">
              <td className="py-2 font-medium text-ink">{r.stage}</td>
              <td className="py-2 text-muted">{r.when}</td>
              <td className="py-2 text-right">{money(r.amount as never)}</td>
              <td className="py-2 text-right text-muted">{r.status}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="py-2 text-right text-sm font-medium text-muted" colSpan={2}>Total sale price</td>
            <td className="py-2 text-right text-base font-semibold text-ink">{money((total || 0) as never)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
      <p className="text-[11px] text-muted">
        Amounts are derived from the contract terms. Dates and instalments may be adjusted by mutual agreement and
        recorded in the special clauses.
      </p>
      {t.clauses && <p className="mt-3 whitespace-pre-wrap">{t.clauses}</p>}
    </div>
  );
}

function NocBody({
  isSale, partyA, partyB, propTitle, propLine,
}: {
  isSale: boolean; partyA: Party; partyB: Party; propTitle: string; propLine: string;
}) {
  return (
    <div className="py-6">
      <p className="mb-4 font-semibold">TO WHOM IT MAY CONCERN</p>
      <p className="mb-4">
        I, <span className="font-medium">{partyA.name}</span> (CNIC {partyA.cnic}), the lawful owner of the property
        described below, hereby state that I have <span className="font-medium">NO OBJECTION</span> to the{" "}
        {isSale ? "sale and transfer" : "tenancy"} of the said property{" "}
        {isSale ? "to" : "in favour of"} <span className="font-medium">{partyB.name}</span> (CNIC {partyB.cnic}).
      </p>
      <PropertyBlock title={propTitle} line={propLine} />
      <p className="mb-2">
        This certificate is issued for the purpose of{" "}
        {isSale ? "transfer / registration of the property" : "lease registration and tenant verification"} on the request
        of the concerned party. I confirm that, to the best of my knowledge, the property is free from any dispute or
        encumbrance.
      </p>
      <div className="mt-12 grid grid-cols-2 gap-10">
        <div>
          <div className="mt-10 border-t border-ink/60" />
          <p className="mt-1 font-medium">{partyA.name}</p>
          <p className="text-[11px] text-muted">Owner — CNIC {partyA.cnic}</p>
        </div>
        <div />
      </div>
    </div>
  );
}

function AffidavitBody({
  isSale, partyA, partyB, propTitle, propLine,
}: {
  isSale: boolean; partyA: Party; partyB: Party; propTitle: string; propLine: string;
}) {
  const deponent = isSale ? partyA : partyB;
  return (
    <div className="py-6">
      <p className="mb-1 text-center font-semibold uppercase tracking-wide">Affidavit</p>
      <p className="mb-4 text-center text-[11px] text-muted">(On stamp paper of the requisite value)</p>
      <p className="mb-4">
        I, <span className="font-medium">{deponent.name}</span>, holder of CNIC {deponent.cnic}, do hereby solemnly affirm
        and declare as under:
      </p>
      <ol className="mb-3 pl-1">
        {isSale ? (
          <>
            <Clause n={1}>That I am the lawful and absolute owner of the property described below.</Clause>
            <Clause n={2}>That the said property is free from all encumbrances, mortgages, charges, litigation and disputes.</Clause>
            <Clause n={3}>That I have full authority to sell and transfer it, and no other person has any right, title or interest therein.</Clause>
            <Clause n={4}>That I have received the agreed consideration and shall indemnify the purchaser against any loss arising from a defect in title.</Clause>
            <Clause n={5}>That the contents of this affidavit are true and correct to the best of my knowledge and belief.</Clause>
          </>
        ) : (
          <>
            <Clause n={1}>That I have taken the property described below on rent from the Landlord on the agreed terms.</Clause>
            <Clause n={2}>That I shall use the premises for lawful purposes only and pay the rent regularly.</Clause>
            <Clause n={3}>That I shall not sublet or structurally alter the premises without the Landlord&rsquo;s written consent.</Clause>
            <Clause n={4}>That I shall bear the utility charges and vacate the premises on expiry / termination as per the agreement.</Clause>
            <Clause n={5}>That the contents of this undertaking are true and correct to the best of my knowledge.</Clause>
          </>
        )}
      </ol>
      <PropertyBlock title={propTitle} line={propLine} />
      <div className="mt-10 grid grid-cols-2 gap-10">
        <div>
          <div className="mt-10 border-t border-ink/60" />
          <p className="mt-1 text-[11px] text-muted">Attested — Oath Commissioner / Notary Public</p>
        </div>
        <div>
          <div className="mt-10 border-t border-ink/60" />
          <p className="mt-1 font-medium">{deponent.name}</p>
          <p className="text-[11px] text-muted">Deponent — CNIC {deponent.cnic}</p>
        </div>
      </div>
    </div>
  );
}

function PowerOfAttorneyBody({
  partyA, partyB, property, propLine,
}: {
  partyA: Party; partyB: Party; property: { title: string; reference: string }; propLine: string;
}) {
  return (
    <div className="py-6">
      <p className="mb-4">
        KNOW ALL MEN BY THESE PRESENTS that I, <span className="font-medium">{partyA.name}</span> (CNIC {partyA.cnic})
        (the “Principal”), do hereby nominate, constitute and appoint{" "}
        <span className="font-medium">{partyB.name}</span> (CNIC {partyB.cnic}) (the “Attorney”) to be my true and lawful
        attorney, to act for me and in my name in respect of the property described below.
      </p>
      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        <PartyCard p={{ ...partyA, role: "Principal (Executant)" }} />
        <PartyCard p={{ ...partyB, role: "Attorney" }} />
      </div>
      <PropertyBlock title={property.title} line={[propLine, `Ref: ${property.reference}`].filter(Boolean).join(" · ")} />

      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Powers granted</p>
      <ol className="mb-2 pl-1">
        <Clause n={1}>To represent me before the Sub-Registrar, housing society, development authority and all concerned offices in respect of the said property.</Clause>
        <Clause n={2}>To sign, execute, present and admit for registration all documents, deeds, transfer and mutation papers relating to the said property.</Clause>
        <Clause n={3}>To pay and receive fees, taxes, dues and to obtain receipts, NOCs and possession on my behalf.</Clause>
        <Clause n={4}>To appear before authorities, give statements, and do all acts necessary to complete the transfer / management of the said property.</Clause>
        <Clause n={5}>That all lawful acts done by the Attorney under this authority shall be binding on me as if done by me personally.</Clause>
      </ol>
      <p className="mb-2 text-[11px] text-muted">
        This Power of Attorney is to be executed on stamp paper of the requisite value and attested before a Notary
        Public / Oath Commissioner.
      </p>
      <div className="mt-12 grid grid-cols-2 gap-10">
        <div>
          <div className="mt-10 border-t border-ink/60" />
          <p className="mt-1 text-[11px] text-muted">Attested — Oath Commissioner / Notary Public</p>
        </div>
        <div>
          <div className="mt-10 border-t border-ink/60" />
          <p className="mt-1 font-medium">{partyA.name}</p>
          <p className="text-[11px] text-muted">Principal — CNIC {partyA.cnic}</p>
        </div>
      </div>
    </div>
  );
}

function TaxCertificateBody({
  partyA, partyB, t, property, propLine,
}: {
  partyA: Party; partyB: Party; t: Terms; property: { title: string; reference: string }; propLine: string;
}) {
  const heads = [
    { head: "Advance Tax — Seller", ref: "u/s 236C" },
    { head: "Advance Tax — Buyer", ref: "u/s 236K" },
    { head: "Capital Value Tax (CVT)", ref: "provincial" },
    { head: "Stamp Duty", ref: "provincial" },
    { head: "Registration / Transfer Fee", ref: "society / registrar" },
  ];
  return (
    <div className="py-6">
      <p className="mb-5">
        This certificate records the tax position for the transfer of the property described below between{" "}
        <span className="font-medium">{partyA.name}</span> (Seller) and <span className="font-medium">{partyB.name}</span> (Buyer).
      </p>
      <div className="mb-5 rounded-md border border-line-soft p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Transaction</p>
        <p className="mt-1 font-medium">{property.title}</p>
        {propLine && <p className="text-muted">{propLine}</p>}
        <p className="text-muted">Ref: {property.reference}</p>
        <p className="mt-1">Declared value: <span className="font-medium">{t.salePrice != null ? money(t.salePrice as never) : "—"}</span></p>
      </div>

      <table className="mb-3 w-full border-collapse text-sm">
        <thead>
          <tr className="border-y border-line text-left text-xs uppercase tracking-wide text-muted">
            <th className="py-2 font-medium">Tax head</th>
            <th className="py-2 font-medium">Reference</th>
            <th className="py-2 font-medium">Challan / CPR no.</th>
            <th className="py-2 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {heads.map((h) => (
            <tr key={h.head} className="border-b border-line-soft">
              <td className="py-2.5 font-medium text-ink">{h.head}</td>
              <td className="py-2.5 text-muted">{h.ref}</td>
              <td className="py-2.5 text-muted">____________________</td>
              <td className="py-2.5 text-right text-muted">____________</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mb-2 text-[11px] text-muted">
        Amounts are to be entered from the paid FBR / provincial challans (CPRs), copies of which are attached. This
        certificate confirms the taxes applicable to the above transfer have been accounted for.
      </p>
      <div className="mt-12 grid grid-cols-2 gap-10">
        <div>
          <div className="mt-10 border-t border-ink/60" />
          <p className="mt-1 font-medium">{partyA.name}</p>
          <p className="text-[11px] text-muted">Seller</p>
        </div>
        <div>
          <div className="mt-10 border-t border-ink/60" />
          <p className="mt-1 font-medium">{partyB.name}</p>
          <p className="text-[11px] text-muted">Buyer</p>
        </div>
      </div>
    </div>
  );
}
