import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { money, humanize, fmtDate } from "@/lib/format";
import { waMeLink, normalizePhone } from "@/lib/whatsapp";
import { StatusBadge } from "@/components/ui/Badge";

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
      companyId: true,
      company: { select: { name: true, logoUrl: true, brandColor: true } },
    },
  });
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

  // Shortlist = properties linked to their leads + properties they've visited.
  const showings = await prisma.showing.findMany({
    where: { companyId: client.companyId, clientId: client.id },
    select: { propertyId: true },
  });
  const propIds = [
    ...new Set([...leads.map((l) => l.propertyId), ...showings.map((s) => s.propertyId)].filter((x): x is string => !!x)),
  ];

  const [properties, appointments, deals, agent] = await Promise.all([
    propIds.length
      ? prisma.property.findMany({
          where: { id: { in: propIds }, companyId: client.companyId },
          select: {
            id: true, reference: true, title: true, type: true, listingType: true, status: true,
            city: true, area: true, salePrice: true, monthlyRent: true, bedrooms: true,
            shareSlug: true, shareEnabled: true,
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
          <p className="mt-1 text-sm text-slate">Your property shortlist, appointments and payments — all in one place.</p>
        </div>

        {/* Shortlist */}
        <section className="surface p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">Your shortlist</h2>
          {properties.length === 0 ? (
            <p className="text-sm text-muted">No properties shortlisted yet — your agent will add some soon.</p>
          ) : (
            <ul className="space-y-2">
              {properties.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-paper px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{p.title}</p>
                    <p className="text-xs text-muted">
                      {[p.area, p.city].filter(Boolean).join(", ")}
                      {p.bedrooms ? ` · ${p.bedrooms} bed` : ""} · {humanize(p.type)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold" style={{ color: accent }}>{priceLine(p)}</p>
                    {p.shareEnabled && p.shareSlug ? (
                      <a href={`/p/${p.shareSlug}`} className="text-xs font-semibold text-accent">View details →</a>
                    ) : (
                      <StatusBadge status={p.status} />
                    )}
                  </div>
                </li>
              ))}
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
