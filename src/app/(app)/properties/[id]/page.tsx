import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireCompanyUser } from "@/lib/session";
import { propertyScope } from "@/lib/scope";
import { can } from "@/lib/rbac";
import { money, humanize, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { StatusBadge } from "@/components/ui/Badge";
import { Timeline } from "@/components/ui/Timeline";
import { StatusChanger } from "@/components/property/StatusChanger";
import { PropertyGallery } from "@/components/property/PropertyGallery";
import { MapView } from "@/components/map/MapView";
import { compactMoney } from "@/lib/format";

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line-soft py-2 text-sm last:border-0">
      <span className="text-muted">{label}</span>
      <span className="text-right font-medium text-ink">{value || "—"}</span>
    </div>
  );
}

export default async function PropertyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireCompanyUser();
  const scope = await propertyScope(user);

  const property = await prisma.property.findFirst({
    where: { id, ...scope },
    include: {
      dealer: true,
      project: true,
      media: { orderBy: { createdAt: "asc" } },
      agents: { include: { agent: true } },
      leads: { include: { client: true }, orderBy: { updatedAt: "desc" }, take: 8 },
      showings: { include: { agent: true, client: true }, orderBy: { createdAt: "desc" }, take: 8 },
      deals: true,
      documents: true,
    },
  });
  if (!property) notFound();

  const activity = await prisma.activityLog.findMany({
    where: { companyId: user.companyId, entityType: "PROPERTY", entityId: id },
    include: { user: true },
    orderBy: { createdAt: "desc" },
    take: 25,
  });

  return (
    <div>
      <PageHeader
        eyebrow={property.reference}
        title={property.title}
        subtitle={[property.area, property.city].filter(Boolean).join(", ") || undefined}
        action={<StatusBadge status={property.status} />}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Section title="Details">
            <div className="grid gap-x-8 sm:grid-cols-2">
              <div>
                <Detail label="Type" value={humanize(property.type)} />
                <Detail label="Purpose" value={humanize(property.listingType)} />
                <Detail label="Sale price" value={property.salePrice ? money(property.salePrice) : null} />
                <Detail label="Monthly rent" value={property.monthlyRent ? money(property.monthlyRent) : null} />
                <Detail label="Deposit" value={property.deposit ? money(property.deposit) : null} />
              </div>
              <div>
                <Detail label="Bedrooms" value={property.bedrooms} />
                <Detail label="Bathrooms" value={property.bathrooms} />
                <Detail label="Covered area" value={property.coveredArea ? `${property.coveredArea} sqft` : null} />
                <Detail label="Project" value={property.project?.name} />
                <Detail label="Available from" value={property.availableFrom ? fmtDate(property.availableFrom) : null} />
              </div>
            </div>
            {property.description && <p className="mt-4 text-sm text-slate">{property.description}</p>}
          </Section>

          <Section title="Media & gallery">
            <PropertyGallery
              propertyId={property.id}
              media={property.media.map((m) => ({ id: m.id, url: m.url, kind: m.kind, caption: m.caption }))}
              canManage={can(user.role, "manageProperties")}
            />
          </Section>

          {property.latitude != null && property.longitude != null && (
            <Section title="Location">
              <p className="mb-3 text-sm text-muted">{[property.address, property.area, property.city].filter(Boolean).join(", ") || "—"}</p>
              <MapView
                single
                height={300}
                markers={[{
                  id: property.id,
                  title: property.title,
                  reference: property.reference,
                  lat: property.latitude,
                  lng: property.longitude,
                  status: property.status,
                  price: property.salePrice ? compactMoney(property.salePrice) : property.monthlyRent ? `${compactMoney(property.monthlyRent)}/mo` : "",
                  href: `/properties/${property.id}`,
                }]}
              />
            </Section>
          )}

          <Section title="Interested leads">
            {property.leads.length === 0 ? (
              <p className="text-sm text-muted">No leads linked yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {property.leads.map((l) => (
                  <li key={l.id} className="flex items-center justify-between py-2">
                    <Link href={`/leads/${l.id}`} className="text-sm font-medium text-ink hover:text-accent">
                      {l.client?.name ?? "Unnamed lead"}
                    </Link>
                    <StatusBadge status={l.stage} />
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Showing history">
            {property.showings.length === 0 ? (
              <p className="text-sm text-muted">No showings recorded.</p>
            ) : (
              <ul className="divide-y divide-line">
                {property.showings.map((s) => (
                  <li key={s.id} className="py-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-ink">{s.agent.name} → {s.client?.name ?? "—"}</span>
                      <StatusBadge status={s.verification} />
                    </div>
                    {s.clientFeedback && <p className="text-xs text-muted">“{s.clientFeedback}”</p>}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div className="space-y-6">
          {can(user.role, "manageProperties") && (
            <Section title="Change status">
              <StatusChanger id={property.id} current={property.status} />
            </Section>
          )}

          <Section title="People">
            <Detail label="Supplier" value={property.dealer?.name ?? property.ownerName} />
            <Detail label="Owner phone" value={property.ownerPhone} />
            <div className="mt-2">
              <p className="mb-1 text-xs font-semibold uppercase text-muted">Assigned agents</p>
              {property.agents.length === 0 ? (
                <p className="text-sm text-muted">None</p>
              ) : (
                <ul className="space-y-1">
                  {property.agents.map((a) => (
                    <li key={a.agentId} className="text-sm text-ink">{a.agent.name}</li>
                  ))}
                </ul>
              )}
            </div>
          </Section>

          <Section title="Activity timeline">
            <Timeline entries={activity.map((a) => ({ id: a.id, summary: a.summary, createdAt: a.createdAt, who: a.user?.name }))} />
          </Section>
        </div>
      </div>
    </div>
  );
}
