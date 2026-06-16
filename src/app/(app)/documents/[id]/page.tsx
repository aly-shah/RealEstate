import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireCompanyUser } from "@/lib/session";
import { fmtDate, fmtDateTime, humanize } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { StatusBadge, Badge } from "@/components/ui/Badge";

/** A url we can hand the user straight to — a real uploaded file, an external
 *  link, or a generated in-app document page. Anything else (placeholder /
 *  imported seed rows) has no source file, so we show a preview instead. */
function isServable(url: string): boolean {
  return /^https?:\/\//i.test(url) || url.startsWith("/api/files/") || url.startsWith("/deal-documents/");
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-line-soft py-2 text-sm last:border-0">
      <span className="text-muted">{label}</span>
      <span className="text-right font-medium text-ink">{value}</span>
    </div>
  );
}

/**
 * Document viewer. The Documents list links here instead of straight to the raw
 * url so every row opens to *something*: real files / generated pages redirect
 * through, while placeholder or imported records (no source file) render a tidy
 * metadata preview rather than a dead 404 link.
 */
export default async function DocumentViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireCompanyUser();

  const doc = await prisma.document.findFirst({
    where: {
      id,
      companyId: user.companyId,
      ...(user.role === "DEALER" ? { dealer: { userId: user.id } } : {}),
    },
    include: { property: true, uploadedBy: true, deal: { select: { id: true, reference: true } } },
  });
  if (!doc) notFound();

  if (isServable(doc.url)) redirect(doc.url);

  const now = new Date();
  const expired = !!doc.expiryDate && doc.expiryDate < now;
  const soon = !!doc.expiryDate && doc.expiryDate >= now && doc.expiryDate <= new Date(now.getTime() + 30 * 86_400_000);

  return (
    <div>
      <PageHeader
        eyebrow="Document"
        title={doc.name}
        subtitle={humanize(doc.type)}
        action={<StatusBadge status={doc.verification} />}
      />
      <div className="mb-3">
        <Link href="/documents" className="text-xs font-semibold text-accent">← All documents</Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Section title="Preview">
            <div className="grid min-h-[320px] place-items-center rounded-xl border border-dashed border-line bg-canvas/40 p-10 text-center">
              <div>
                <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-accent-wash text-xl text-accent">📄</div>
                <p className="text-sm font-medium text-ink">{doc.name}</p>
                <p className="mt-1 text-sm text-muted">No source file is attached to this record.</p>
                <p className="mt-1 text-xs text-muted">Placeholder / imported entry — upload a file from the Documents list to replace it.</p>
              </div>
            </div>
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="Details">
            <Row label="Type" value={humanize(doc.type)} />
            <Row label="Status" value={<StatusBadge status={doc.verification} />} />
            <Row label="Uploaded by" value={doc.uploadedBy?.name ?? "—"} />
            <Row label="Linked property" value={doc.property?.reference ?? "—"} />
            <Row
              label="Linked deal"
              value={doc.deal ? <Link href={`/deals/${doc.deal.id}`} className="text-accent">{doc.deal.reference}</Link> : "—"}
            />
            <Row
              label="Expiry"
              value={
                <span className="inline-flex items-center gap-2">
                  {fmtDate(doc.expiryDate)}
                  {expired && <Badge tone="danger">Expired</Badge>}
                  {soon && <Badge tone="warn">Soon</Badge>}
                </span>
              }
            />
            <Row label="Added" value={fmtDateTime(doc.createdAt)} />
          </Section>
        </div>
      </div>
    </div>
  );
}
