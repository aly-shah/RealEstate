import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { toNumber, compactMoney, humanize, localizeDigits, localizedStatus } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { Section } from "@/components/ui/Section";
import { StatusBadge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { getDict } from "@/lib/i18n/server";

export async function DealerDashboard({
  companyId,
  userId,
}: {
  companyId: string;
  userId: string;
}) {
  const { locale, dict } = await getDict();

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
        <PageHeader title={dict.dashboard.dealer.eyebrow} />
        <p className="text-sm text-muted">{dict.empty.noDealerProfile}</p>
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
      <PageHeader eyebrow={dict.dashboard.dealer.eyebrow} title={dealer.name} subtitle={dealer.areaOfOperation ?? undefined} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={dict.stats.inventory} value={localizeDigits(dealer.properties.length, locale)} sub={`${localizeDigits(available, locale)} ${dict.common.available}`} tone="ink" icon={<Icon name="home" />} />
        <StatCard label={dict.stats.dealsClosed} value={localizeDigits(dealer.deals.length, locale)} tone="accent" icon={<Icon name="exchange" />} />
        <StatCard label={dict.stats.shareEarned} value={compactMoney(earned, locale)} tone="ok" icon={<Icon name="check" />} />
        <StatCard label={dict.stats.sharePending} value={compactMoney(pending, locale)} tone="gold" icon={<Icon name="percent" />} />
      </div>

      <Section title={dict.sections.yourInventory}>
        {dealer.properties.length === 0 ? (
          <p className="text-sm text-muted">{dict.empty.noLinkedProperties}</p>
        ) : (
          <ul className="divide-y divide-line">
            {dealer.properties.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{p.title}</p>
                  <p className="text-xs text-muted">
                    <span data-keep-latin>{p.reference}</span> · {localizedStatus(p.type, dict.status) || humanize(p.type)}
                  </p>
                </div>
                <StatusBadge status={p.status} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={dict.sections.dealsThroughInventory}>
        {dealer.deals.length === 0 ? (
          <p className="text-sm text-muted">{dict.empty.noClosedDeals}</p>
        ) : (
          <ul className="divide-y divide-line">
            {dealer.deals.map((d) => (
              <li key={d.id} className="flex items-center justify-between py-2.5">
                <div>
                  <p className="text-sm font-semibold text-ink" data-keep-latin>{d.reference}</p>
                  <p className="text-xs text-muted">{d.property.title}</p>
                </div>
                <Link href={`/deals/${d.id}`} className="text-xs font-semibold text-accent">{dict.common.viewAll} →</Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
