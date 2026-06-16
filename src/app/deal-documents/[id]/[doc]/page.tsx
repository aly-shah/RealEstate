import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { money, fmtDate, fmtDateTime, toNumber } from "@/lib/format";
import { Brand } from "@/components/ui/Brand";
import { PrintButton } from "@/components/PrintButton";
import { DEAL_DOC_KINDS, type DealDocKind } from "@/lib/deal-documents";

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
  if (!DEAL_DOC_KINDS.includes(doc as DealDocKind)) notFound();
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

  const propLine = [deal.property.address, deal.property.area, deal.property.city].filter(Boolean).join(", ");
  const title =
    kind === "agreement"
      ? isSale ? "Agreement to Sell" : "Rental / Lease Agreement"
      : kind === "receipt"
        ? isSale ? "Token / Booking Receipt" : "Security Deposit Receipt"
        : "Possession / Handover Note";

  const backHref = `/deals/${deal.id}`;

  return (
    <div className="min-h-screen bg-canvas px-4 py-8 print:bg-white print:p-0">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex items-center justify-between print:hidden">
          <Link href={backHref} className="text-sm text-muted hover:text-ink">← Back to deal</Link>
          <PrintButton />
        </div>

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

          {kind === "agreement" && (
            <AgreementBody isSale={isSale} partyA={partyA} partyB={partyB} t={t} property={deal.property} propLine={propLine} />
          )}
          {kind === "receipt" && (
            <ReceiptBody isSale={isSale} partyA={partyA} partyB={partyB} t={t} reference={deal.reference} propTitle={deal.property.title} />
          )}
          {kind === "possession" && (
            <PossessionBody isSale={isSale} partyA={partyA} partyB={partyB} t={t} propTitle={deal.property.title} propLine={propLine} />
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
