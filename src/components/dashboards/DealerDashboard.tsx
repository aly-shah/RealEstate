import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { toNumber, money, compactMoney, humanize, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { Section } from "@/components/ui/Section";
import { StatusBadge, Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";

const BOOKING_TONE: Record<string, "ok" | "warn" | "danger" | "neutral"> = {
  PENDING: "warn", APPROVED: "ok", REJECTED: "danger", CANCELLED: "neutral",
};

/**
 * Dealer home (channel partner). Surfaces the builder workflow: inventory
 * allocated to the dealer to sell, their bookings + approval status, and their
 * commission — earned, pending payout, and a forecast from pending bookings
 * (booking value × the dealer's agreed share %).
 */
export async function DealerDashboard({ companyId, userId }: { companyId: string; userId: string }) {
  const dealer = await prisma.dealer.findFirst({
    where: { companyId, userId },
    select: { id: true, name: true, areaOfOperation: true, defaultSharePct: true },
  });

  if (!dealer) {
    return (
      <div className="space-y-6">
        <PageHeader title="Dealer" />
        <p className="text-sm text-muted">No dealer profile is linked to your account yet — ask the office to set one up.</p>
      </div>
    );
  }

  const [allocated, bookings, bookingAgg, shares, dealsWon] = await Promise.all([
    prisma.property.findMany({
      where: { companyId, dealerId: dealer.id },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 50,
      select: { id: true, reference: true, title: true, type: true, status: true, salePrice: true },
    }),
    prisma.booking.findMany({
      where: { companyId, dealerId: dealer.id },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, status: true, price: true, createdAt: true, clientName: true, property: { select: { reference: true } } },
    }),
    prisma.booking.groupBy({ by: ["status"], where: { companyId, dealerId: dealer.id }, _count: { _all: true }, _sum: { price: true } }),
    prisma.commissionShare.findMany({ where: { dealerId: dealer.id, commission: { companyId } }, select: { amount: true, paid: true } }),
    prisma.deal.count({ where: { companyId, dealerId: dealer.id, status: "CLOSED_WON" } }),
  ]);

  const sharePct = toNumber(dealer.defaultSharePct);
  const earned = shares.filter((s) => s.paid).reduce((s, x) => s + toNumber(x.amount), 0);
  const pendingPayout = shares.filter((s) => !s.paid).reduce((s, x) => s + toNumber(x.amount), 0);

  const availableUnits = allocated.filter((p) => p.status === "AVAILABLE");
  const availableValue = availableUnits.reduce((s, p) => s + toNumber(p.salePrice), 0);

  const pendingAgg = bookingAgg.find((g) => g.status === "PENDING");
  const pendingCount = pendingAgg?._count._all ?? 0;
  const pendingValue = toNumber(pendingAgg?._sum.price);
  // Forecast: what the dealer earns if their pending bookings are approved.
  const forecast = (pendingValue * sharePct) / 100;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Dealer" title={dealer.name} subtitle={dealer.areaOfOperation ?? undefined} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Available to sell" value={availableUnits.length} sub={compactMoney(availableValue)} tone="ink" icon={<Icon name="home" />} />
        <StatCard label="Pending bookings" value={pendingCount} sub={pendingValue ? compactMoney(pendingValue) : "—"} tone="gold" icon={<Icon name="flag" />} />
        <StatCard label="Forecast" value={compactMoney(forecast)} sub={`@ ${sharePct}% share`} tone="accent" icon={<Icon name="percent" />} />
        <StatCard label="Earned" value={compactMoney(earned)} tone="ok" icon={<Icon name="check" />} />
        <StatCard label="Pending payout" value={compactMoney(pendingPayout)} tone="gold" icon={<Icon name="banknote" />} />
        <StatCard label="Deals closed" value={dealsWon} tone="accent" icon={<Icon name="exchange" />} />
      </div>

      {/* Inventory to sell */}
      <Section title="Your inventory to sell" action={<Link href="/bookings" className="text-xs font-semibold text-accent">Book a unit →</Link>}>
        {allocated.length === 0 ? (
          <p className="text-sm text-muted">No units are allocated to you yet — the office assigns project towers for you to sell.</p>
        ) : (
          <ul className="divide-y divide-line">
            {allocated.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{p.title}</p>
                  <p className="text-xs text-muted"><span data-keep-latin>{p.reference}</span> · {humanize(p.type)}{p.salePrice != null ? ` · ${money(p.salePrice)}` : ""}</p>
                </div>
                <StatusBadge status={p.status} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* My bookings */}
      <Section title="Your bookings" action={<Link href="/bookings" className="text-xs font-semibold text-accent">All bookings →</Link>}>
        {bookings.length === 0 ? (
          <p className="text-sm text-muted">No bookings yet — reserve an available unit for a buyer to get started.</p>
        ) : (
          <ul className="divide-y divide-line">
            {bookings.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink"><span data-keep-latin>{b.property?.reference ?? "—"}</span></p>
                  <p className="text-xs text-muted">{b.clientName ?? "Buyer"} · {money(b.price)} · {fmtDate(b.createdAt)}</p>
                </div>
                <Badge tone={BOOKING_TONE[b.status] ?? "neutral"}>{b.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
