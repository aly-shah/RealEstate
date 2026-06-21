import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { money, humanize, fmtDate } from "@/lib/format";
import { waMeLink, normalizePhone } from "@/lib/whatsapp";
import { StatusBadge } from "@/components/ui/Badge";
import { PortalBooking } from "./PortalBooking";

export const metadata: Metadata = {
  title: "Your property portal",
  robots: { index: false, follow: false },
};

async function getClient(token: string) {
  return prisma.client.findFirst({
    where: { portalToken: token, portalEnabled: true },
    select: {
      id: true,
      name: true,
      phone: true,
      type: true,
      companyId: true,
      company: { select: { name: true, logoUrl: true, brandColor: true } },
    },
  });
}

/** A document we can hand the client a working download link for (vs a placeholder). */
function isServableDoc(url: string): boolean {
  return /^https?:\/\//i.test(url) || url.startsWith("/api/files/");
}

// Pipeline stages that count as a live "offer" on a seller's listing.
const OFFER_STATUSES = ["NEGOTIATION", "TOKEN", "BOOKED", "AGREEMENT"] as const;

/**
 * Seller view data: the listings this client owns (matched by owner phone within
 * the tenant) and the engagement on each — views, interested leads, scheduled/
 * completed showings, and live offers (deals in negotiation+). Returns null when
 * the client has no phone or owns no listings, so the portal stays buyer-only.
 */
async function sellerListings(companyId: string, phone: string | null) {
  if (!phone) return null;
  const listings = await prisma.property.findMany({
    where: { companyId, ownerPhone: phone },
    select: {
      id: true, reference: true, title: true, type: true, listingType: true, status: true,
      city: true, area: true, salePrice: true, monthlyRent: true,
    },
    orderBy: { createdAt: "desc" },
  });
  if (listings.length === 0) return null;

  const ids = listings.map((p) => p.id);
  const [views, leadCounts, showingCounts, offerCounts] = await Promise.all([
    prisma.propertyView.groupBy({ by: ["propertyId"], where: { companyId, propertyId: { in: ids } }, _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["propertyId"], where: { companyId, propertyId: { in: ids } }, _count: { _all: true } }),
    prisma.showing.groupBy({ by: ["propertyId"], where: { companyId, propertyId: { in: ids } }, _count: { _all: true } }),
    prisma.deal.groupBy({ by: ["propertyId"], where: { companyId, propertyId: { in: ids }, status: { in: [...OFFER_STATUSES] } }, _count: { _all: true } }),
  ]);
  const toMap = (rows: { propertyId: string | null; _count: { _all: number } }[]) =>
    new Map(rows.map((r) => [r.propertyId, r._count._all]));
  const vMap = toMap(views), lMap = toMap(leadCounts), sMap = toMap(showingCounts), oMap = toMap(offerCounts);

  const rows = listings.map((p) => ({
    ...p,
    views: vMap.get(p.id) ?? 0,
    leads: lMap.get(p.id) ?? 0,
    showings: sMap.get(p.id) ?? 0,
    offers: oMap.get(p.id) ?? 0,
  }));
  const totals = rows.reduce(
    (t, r) => ({ views: t.views + r.views, leads: t.leads + r.leads, offers: t.offers + r.offers }),
    { views: 0, leads: 0, offers: 0 },
  );
  return { rows, totals, count: rows.length };
}

function Unavailable() {
  return (
    <div className="grid min-h-screen place-items-center bg-canvas px-6">
      <div className="surface max-w-md p-8 text-center">
        <h1 className="text-lg font-semibold text-ink">This portal isn’t available</h1>
        <p className="mt-2 text-sm text-muted">
          The link may have been turned off. Please ask your agent for an updated link.
        </p>
      </div>
    </div>
  );
}

export default async function ClientPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const client = await getClient(token);
  if (!client) return <Unavailable />;

  const accent = client.company.brandColor || "#4f46e5";

  // The client's leads anchor everything else (properties of interest, appointments).
  const leads = await prisma.lead.findMany({
    where: { companyId: client.companyId, clientId: client.id },
    select: { id: true, propertyId: true, agentId: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });
  const leadIds = leads.map((l) => l.id);
  // Properties the client can self-book a viewing for — those linked to one of
  // their leads (the lead carries the agent the booking is assigned to).
  const bookablePropIds = new Set(leads.map((l) => l.propertyId).filter((x): x is string => !!x));

  // Shortlist = properties linked to their leads + properties they've visited.
  const showings = await prisma.showing.findMany({
    where: { companyId: client.companyId, clientId: client.id },
    select: { propertyId: true },
  });
  const propIds = [
    ...new Set([...leads.map((l) => l.propertyId), ...showings.map((s) => s.propertyId)].filter((x): x is string => !!x)),
  ];

  const [properties, appointments, deals, agent, documents, sellerData] = await Promise.all([
    propIds.length
      ? prisma.property.findMany({
          where: { id: { in: propIds }, companyId: client.companyId },
          select: {
            id: true, reference: true, title: true, type: true, listingType: true, status: true,
            city: true, area: true, salePrice: true, monthlyRent: true, bedrooms: true,
            shareSlug: true, shareEnabled: true,
            media: {
              where: { kind: { in: ["PHOTO", "FLOOR_PLAN"] } },
              orderBy: { createdAt: "asc" },
              take: 1,
              select: { id: true },
            },
          },
        })
      : Promise.resolve([]),
    leadIds.length
      ? prisma.calendarEvent.findMany({
          where: { companyId: client.companyId, leadId: { in: leadIds }, startAt: { gt: new Date() }, status: "SCHEDULED" },
          orderBy: { startAt: "asc" },
          take: 10,
          select: { id: true, type: true, title: true, startAt: true, property: { select: { reference: true, title: true } } },
        })
      : Promise.resolve([]),
    prisma.deal.findMany({
      where: { companyId: client.companyId, clientId: client.id },
      select: {
        reference: true,
        type: true,
        property: { select: { title: true } },
        payments: {
          orderBy: { dueDate: "asc" },
          select: { type: true, amount: true, status: true, dueDate: true },
        },
      },
    }),
    // Agent contact — the most recently-touched lead's agent.
    (async () => {
      const agentId = leads.find((l) => l.agentId)?.agentId;
      return agentId
        ? prisma.user.findUnique({ where: { id: agentId }, select: { name: true, phone: true } })
        : null;
    })(),
    // Documents shared with this client (verified contracts, receipts, etc.).
    prisma.document.findMany({
      where: { companyId: client.companyId, clientId: client.id },
      orderBy: { version: "desc" },
      take: 20,
      select: { id: true, name: true, type: true, url: true, verification: true, expiryDate: true },
    }),
    // Seller view: properties this client owns (matched by owner phone) + the
    // engagement on each. Only runs when the client has a phone on file.
    sellerListings(client.companyId, client.phone),
  ]);

  const priceLine = (p: { salePrice: unknown; monthlyRent: unknown }) =>
    p.salePrice != null ? money(p.salePrice as never)
      : p.monthlyRent != null ? `${money(p.monthlyRent as never)} / month`
        : "Price on request";

  const wa = agent?.phone ? waMeLink(agent.phone, `Hi ${agent.name ?? ""}, a question about my property search.`) : null;
  const tel = agent?.phone ? normalizePhone(agent.phone) : null;

  return (
    <div className="min-h-screen bg-canvas">
      <div className="h-1.5 w-full" style={{ backgroundColor: accent }} aria-hidden />
      <header className="border-b border-line bg-paper">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-5 py-4">
          {client.company.logoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={client.company.logoUrl} alt={client.company.name} className="h-9 w-auto" />
          ) : (
            <span className="grid h-9 w-9 place-items-center rounded-xl text-white" style={{ backgroundColor: accent }}>
              {client.company.name.charAt(0)}
            </span>
          )}
          <span className="text-lg font-semibold tracking-tight text-ink">{client.company.name}</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-5 py-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Welcome, {client.name}</h1>
          <p className="mt-1 text-sm text-slate">
            {sellerData
              ? "Track interest in your listings, plus your appointments and documents — all in one place."
              : "Your property shortlist, appointments and payments — all in one place."}
          </p>
        </div>

        {/* Seller dashboard — engagement on the client's own listings */}
        {sellerData && (
          <section className="surface p-5">
            <h2 className="mb-3 text-sm font-semibold text-ink">Your listings</h2>
            <div className="mb-4 grid grid-cols-3 gap-3">
              {[
                { label: "Total views", value: sellerData.totals.views },
                { label: "Interested leads", value: sellerData.totals.leads },
                { label: "Live offers", value: sellerData.totals.offers },
              ].map((s) => (
                <div key={s.label} className="rounded-xl border border-line bg-paper p-3 text-center">
                  <p className="text-2xl font-bold leading-none" style={{ color: accent }}>{s.value}</p>
                  <p className="mt-1 text-[11px] text-muted">{s.label}</p>
                </div>
              ))}
            </div>
            <ul className="space-y-2">
              {sellerData.rows.map((p) => (
                <li key={p.id} className="rounded-xl border border-line bg-paper p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{p.title}</p>
                      <p className="text-xs text-muted">{[p.area, p.city].filter(Boolean).join(", ")} · {humanize(p.type)}</p>
                      <p className="mt-0.5 text-sm font-semibold" style={{ color: accent }}>{priceLine(p)}</p>
                    </div>
                    <StatusBadge status={p.status} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate">
                    <span>👁 {p.views} views</span>
                    <span>👤 {p.leads} leads</span>
                    <span>📅 {p.showings} showings</span>
                    <span>💬 {p.offers} offers</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Shortlist */}
        <section className="surface p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">Your shortlist</h2>
          {properties.length === 0 ? (
            <p className="text-sm text-muted">No properties shortlisted yet — your agent will add some soon.</p>
          ) : (
            <ul className="space-y-2">
              {properties.map((p) => {
                const cover = p.media[0]
                  ? `/api/public/portal-media/${token}/${p.id}/${p.media[0].id}`
                  : null;
                return (
                  <li key={p.id} className="flex items-center gap-3 rounded-xl border border-line bg-paper p-3">
                    {cover ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={cover} alt={p.title} className="h-16 w-16 shrink-0 rounded-lg object-cover" loading="lazy" />
                    ) : (
                      <div className="grid h-16 w-16 shrink-0 place-items-center rounded-lg bg-line-soft text-muted">
                        <span className="text-lg">🏠</span>
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{p.title}</p>
                      <p className="text-xs text-muted">
                        {[p.area, p.city].filter(Boolean).join(", ")}
                        {p.bedrooms ? ` · ${p.bedrooms} bed` : ""} · {humanize(p.type)}
                      </p>
                      <p className="mt-0.5 text-sm font-semibold" style={{ color: accent }}>{priceLine(p)}</p>
                      {bookablePropIds.has(p.id) && (
                        <PortalBooking token={token} propertyId={p.id} accent={accent} />
                      )}
                    </div>
                    <div className="shrink-0 self-start text-right">
                      {p.shareEnabled && p.shareSlug ? (
                        // ?c= attributes the view to this client (feeds high-intent scoring).
                        <a href={`/p/${p.shareSlug}?c=${client.id}`} className="text-xs font-semibold text-accent">View →</a>
                      ) : (
                        <StatusBadge status={p.status} />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Appointments */}
        {appointments.length > 0 && (
          <section className="surface p-5">
            <h2 className="mb-3 text-sm font-semibold text-ink">Upcoming appointments</h2>
            <ul className="divide-y divide-line">
              {appointments.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <span className="font-medium text-ink">{humanize(a.type)}</span>
                    {a.property && <span className="ml-2 text-xs text-muted">{a.property.title}</span>}
                  </div>
                  <span className="text-xs text-muted">{fmtDate(a.startAt)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Payments */}
        {deals.some((d) => d.payments.length > 0) && (
          <section className="surface p-5">
            <h2 className="mb-3 text-sm font-semibold text-ink">Payments</h2>
            <div className="space-y-4">
              {deals.filter((d) => d.payments.length > 0).map((d) => (
                <div key={d.reference}>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{d.property.title}</p>
                  <ul className="divide-y divide-line">
                    {d.payments.map((pay, i) => {
                      const overdue = pay.status !== "PAID" && !!pay.dueDate && pay.dueDate < new Date();
                      return (
                        <li key={i} className="flex items-center justify-between py-2 text-sm">
                          <div>
                            <span className="font-medium text-ink">{humanize(pay.type)}</span>
                            <span className="ml-2 text-muted">{money(pay.amount)}</span>
                            {pay.dueDate && pay.status !== "PAID" && (
                              <span className="ml-2 text-xs text-muted">due {fmtDate(pay.dueDate)}</span>
                            )}
                          </div>
                          <StatusBadge status={overdue ? "OVERDUE" : pay.status} />
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Documents */}
        {documents.length > 0 && (
          <section className="surface p-5">
            <h2 className="mb-3 text-sm font-semibold text-ink">Documents</h2>
            <ul className="divide-y divide-line">
              {documents.map((d) => {
                const expired = !!d.expiryDate && d.expiryDate < new Date();
                return (
                  <li key={d.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">{d.name}</p>
                      <p className="text-xs text-muted">
                        {humanize(d.type)}
                        {d.expiryDate && <span className={expired ? "text-danger" : ""}> · {expired ? "expired" : "expires"} {fmtDate(d.expiryDate)}</span>}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <StatusBadge status={d.verification} />
                      {isServableDoc(d.url) && (
                        <a
                          href={`/api/public/portal-doc/${token}/${d.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-semibold"
                          style={{ color: accent }}
                        >
                          View →
                        </a>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Agent contact */}
        {(wa || tel) && (
          <section className="surface flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <h2 className="text-sm font-semibold text-ink">Questions?</h2>
              <p className="text-sm text-muted">{agent?.name ? `Contact ${agent.name}` : "Contact your agent"} any time.</p>
            </div>
            <div className="flex gap-2">
              {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="btn-primary">WhatsApp</a>}
              {tel && <a href={`tel:${tel}`} className="btn-ghost">Call</a>}
            </div>
          </section>
        )}

        <footer className="pb-8 pt-2 text-center text-xs text-muted">{client.company.name}</footer>
      </main>
    </div>
  );
}
