import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { toNumber, compactMoney, humanize } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { Section } from "@/components/ui/Section";
import { StatusBadge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";

export async function DealerDashboard({
  companyId,
  userId,
}: {
  companyId: string;
  userId: string;
}) {
  const dealer = await prisma.dealer.findFirst({
    where: { companyId, userId },
    include: {
      properties: { orderBy: { createdAt: "desc" } },
      deals: { where: { status: "CLOSED_WON" }, include: { property: true } },
    },
  });

  if (!dealer) {
    return (
      <div className="space-y-6">
        <PageHeader title="Dealer dashboard" />
        <p className="text-sm text-muted">No dealer profile is linked to your account yet. Ask an admin to set it up.</p>
      </div>
    );
  }

  const shares = await prisma.commissionShare.findMany({
    where: { dealerId: dealer.id, commission: { companyId } },
    select: { amount: true, paid: true },
  });
  const earned = shares.filter((s) => s.paid).reduce((s, x) => s + toNumber(x.amount), 0);
  const pending = shares.filter((s) => !s.paid).reduce((s, x) => s + toNumber(x.amount), 0);
  const available = dealer.properties.filter((p) => p.status === "AVAILABLE").length;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Dealer dashboard" title={dealer.name} subtitle={dealer.areaOfOperation ?? undefined} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Inventory" value={dealer.properties.length} sub={`${available} available`} tone="ink" icon={<Icon name="home" />} />
        <StatCard label="Deals closed" value={dealer.deals.length} tone="accent" icon={<Icon name="exchange" />} />
        <StatCard label="Share earned" value={compactMoney(earned)} tone="ok" icon={<Icon name="check" />} />
        <StatCard label="Share pending" value={compactMoney(pending)} tone="gold" icon={<Icon name="percent" />} />
      </div>

      <Section title="Your inventory">
        {dealer.properties.length === 0 ? (
          <p className="text-sm text-muted">No properties linked to your profile.</p>
        ) : (
          <ul className="divide-y divide-line">
            {dealer.properties.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{p.title}</p>
                  <p className="text-xs text-muted">{p.reference} · {humanize(p.type)}</p>
                </div>
                <StatusBadge status={p.status} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Deals through your inventory">
        {dealer.deals.length === 0 ? (
          <p className="text-sm text-muted">No closed deals yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {dealer.deals.map((d) => (
              <li key={d.id} className="flex items-center justify-between py-2.5">
                <div>
                  <p className="text-sm font-semibold text-ink">{d.reference}</p>
                  <p className="text-xs text-muted">{d.property.title}</p>
                </div>
                <Link href={`/deals/${d.id}`} className="text-xs font-semibold text-accent">View →</Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
