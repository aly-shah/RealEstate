import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/session";
import { toNumber, compactMoney } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { StatCard } from "@/components/ui/StatCard";
import { StatusBadge } from "@/components/ui/Badge";
import { WhatsAppButton } from "@/components/whatsapp/WhatsAppButton";

export default async function DealerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireCapability("manageUsers");

  const dealer = await prisma.dealer.findFirst({
    where: { id, companyId: user.companyId! },
    include: {
      properties: { orderBy: { createdAt: "desc" } },
      deals: { include: { property: true }, orderBy: { createdAt: "desc" } },
      documents: true,
    },
  });
  if (!dealer) notFound();

  const shares = await prisma.commissionShare.findMany({
    where: { dealerId: dealer.id, commission: { companyId: user.companyId! } },
    select: { amount: true, paid: true },
  });
  const earned = shares.filter((s) => s.paid).reduce((s, x) => s + toNumber(x.amount), 0);
  const pending = shares.filter((s) => !s.paid).reduce((s, x) => s + toNumber(x.amount), 0);

  return (
    <div>
      <PageHeader
        eyebrow="Dealer"
        title={dealer.name}
        subtitle={[dealer.companyName, dealer.areaOfOperation].filter(Boolean).join(" · ") || undefined}
        action={
          <div className="flex items-center gap-2">
            <WhatsAppButton
              phone={dealer.contact}
              label="WhatsApp"
              size="md"
              // A short opener fits the dealer relationship — they're a counterparty,
              // not a client, so we skip the "Salaam" + "thanks for reaching out" framing.
              message={`Hi ${dealer.name}, following up about ${dealer.areaOfOperation ? dealer.areaOfOperation + " " : ""}inventory.`}
            />
            <StatusBadge status={dealer.status} />
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Inventory" value={dealer.properties.length} tone="ink" />
        <StatCard label="Deals" value={dealer.deals.length} tone="accent" />
        <StatCard label="Share earned" value={compactMoney(earned)} />
        <StatCard label="Share pending" value={compactMoney(pending)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Linked inventory">
          {dealer.properties.length === 0 ? (
            <p className="text-sm text-muted">No properties linked.</p>
          ) : (
            <ul className="divide-y divide-line">
              {dealer.properties.map((p) => (
                <li key={p.id} className="flex items-center justify-between py-2">
                  <Link href={`/properties/${p.id}`} className="text-sm font-medium text-ink hover:text-accent">{p.title}</Link>
                  <StatusBadge status={p.status} />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Deals through this dealer">
          {dealer.deals.length === 0 ? (
            <p className="text-sm text-muted">No deals yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {dealer.deals.map((d) => (
                <li key={d.id} className="flex items-center justify-between py-2">
                  <div>
                    <Link href={`/deals/${d.id}`} className="text-sm font-medium text-ink hover:text-accent">{d.reference}</Link>
                    <p className="text-xs text-muted">{d.property.title}</p>
                  </div>
                  <StatusBadge status={d.status} />
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <div className="mt-6">
        <Section title="Profile">
          <dl className="grid gap-x-8 sm:grid-cols-2">
            <div className="flex justify-between border-b border-line-soft py-2 text-sm"><dt className="text-muted">Contact</dt><dd className="font-medium text-ink">{dealer.contact ?? "—"}</dd></div>
            <div className="flex justify-between border-b border-line-soft py-2 text-sm"><dt className="text-muted">Default share</dt><dd className="font-medium text-ink">{toNumber(dealer.defaultSharePct)}%</dd></div>
          </dl>
          {dealer.notes && <p className="mt-3 text-sm text-slate">{dealer.notes}</p>}
        </Section>
      </div>
    </div>
  );
}
