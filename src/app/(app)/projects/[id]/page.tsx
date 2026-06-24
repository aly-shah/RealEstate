import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCompanyUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { money, compactMoney, toNumber, humanize, fmtDate } from "@/lib/format";
import { MapView, type MapMarker } from "@/components/map/MapView";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { StatCard } from "@/components/ui/StatCard";
import { Table, Td } from "@/components/ui/Table";
import { StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ProjectManage } from "./ProjectManage";
import { EditProject } from "./EditProject";
import { UnitActions } from "./UnitActions";
import { ProjectMediaManager } from "./ProjectMediaManager";

const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

const UNIT_CAP = 300;

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireCompanyUser();
  const canManage = can(user.role, "viewCompanyReports");

  const project = await prisma.project.findFirst({
    where: { id, companyId: user.companyId },
    select: {
      id: true, name: true, city: true, area: true, status: true, isOffPlan: true, description: true,
      address: true, latitude: true, longitude: true, totalFloors: true, parkingFloors: true, launchDate: true, completionDate: true, amenities: true,
      media: { orderBy: { createdAt: "asc" }, select: { id: true, kind: true, url: true, caption: true } },
    },
  });
  if (!project) notFound();

  const [unitTypes, statusAgg, units, dealers, towerRows] = await Promise.all([
    prisma.unitType.findMany({
      where: { companyId: user.companyId, projectId: id },
      orderBy: { basePrice: "asc" },
      select: { id: true, name: true, bedrooms: true, bathrooms: true, areaValue: true, areaUnit: true, basePrice: true, floorRise: true, tower: true, floorFrom: true, floorTo: true, unitsPerFloor: true },
    }),
    prisma.property.groupBy({
      by: ["status"],
      where: { companyId: user.companyId, projectId: id },
      _count: { _all: true },
      _sum: { salePrice: true },
    }),
    prisma.property.findMany({
      where: { companyId: user.companyId, projectId: id },
      orderBy: [{ tower: "asc" }, { floorNumber: "desc" }, { unitNumber: "asc" }],
      take: UNIT_CAP,
      select: { id: true, reference: true, tower: true, floorNumber: true, unitNumber: true, status: true, salePrice: true, unitType: { select: { name: true } }, dealer: { select: { name: true } } },
    }),
    canManage ? prisma.dealer.findMany({ where: { companyId: user.companyId, status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : Promise.resolve([]),
    // Distinct towers in this project — drives the allocation picker.
    prisma.property.findMany({ where: { companyId: user.companyId, projectId: id, tower: { not: null } }, distinct: ["tower"], select: { tower: true }, orderBy: { tower: "asc" } }),
  ]);
  const towers = towerRows.map((t) => t.tower!).filter(Boolean);

  let total = 0, available = 0, reserved = 0, sold = 0, gross = 0, soldValue = 0;
  for (const g of statusAgg) {
    const n = g._count._all;
    const val = toNumber(g._sum.salePrice);
    total += n; gross += val;
    if (g.status === "AVAILABLE") available += n;
    else if (g.status === "SOLD") { sold += n; soldValue += val; }
    else if (g.status === "RESERVED" || g.status === "UNDER_NEGOTIATION") reserved += n;
  }

  return (
    <div>
      <PageHeader
        eyebrow="Project"
        title={project.name}
        subtitle={[project.area, project.city].filter(Boolean).join(", ") || undefined}
        action={canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            <EditProject project={{
              id: project.id, name: project.name, status: project.status,
              city: project.city ?? "", area: project.area ?? "", address: project.address ?? "",
              latitude: project.latitude, longitude: project.longitude,
              totalFloors: project.totalFloors != null ? String(project.totalFloors) : "",
              parkingFloors: project.parkingFloors != null ? String(project.parkingFloors) : "",
              isOffPlan: project.isOffPlan, launchDate: isoDate(project.launchDate), completionDate: isoDate(project.completionDate),
              amenities: project.amenities, description: project.description ?? "",
            }} />
            <ProjectManage projectId={project.id} status={project.status} unitTypes={unitTypes.map((t) => ({ id: t.id, name: t.name }))} hasTypes={unitTypes.length > 0} dealers={dealers} towers={towers} totalFloors={project.totalFloors} parkingFloors={project.parkingFloors} />
          </div>
        ) : null}
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total units" value={total} tone="ink" />
        <StatCard label="Available" value={available} tone="ok" />
        <StatCard label="Reserved" value={reserved} tone="gold" />
        <StatCard label="Sold" value={sold} tone="accent" sub={total ? `${Math.round((sold / total) * 100)}% of inventory` : undefined} />
        <StatCard label="Gross inventory value" value={compactMoney(gross)} tone="ink" />
        <StatCard label="Sold value" value={compactMoney(soldValue)} tone="accent" />
      </div>

      {/* Overview */}
      {(project.description || project.amenities.length > 0 || project.latitude != null || project.totalFloors != null || project.launchDate || project.address) && (
        <Section title="Overview" className="mb-6">
          <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
            <div>
              {project.description && <p className="text-sm leading-relaxed text-slate">{project.description}</p>}
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                {project.totalFloors != null && <div><dt className="text-xs text-muted">Floors</dt><dd className="font-medium text-ink">{project.totalFloors}{project.parkingFloors ? ` · ${project.parkingFloors} parking` : ""}</dd></div>}
                {project.totalFloors != null && project.parkingFloors != null && project.parkingFloors < project.totalFloors && (
                  <div><dt className="text-xs text-muted">Apartment floors</dt><dd className="font-medium text-ink">{project.parkingFloors + 1}–{project.totalFloors}</dd></div>
                )}
                <div><dt className="text-xs text-muted">Stage</dt><dd className="font-medium text-ink">{project.isOffPlan ? "Off-plan" : "Ready"}</dd></div>
                {project.launchDate && <div><dt className="text-xs text-muted">Start</dt><dd className="font-medium text-ink">{fmtDate(project.launchDate)}</dd></div>}
                {project.completionDate && <div><dt className="text-xs text-muted">Completion</dt><dd className="font-medium text-ink">{fmtDate(project.completionDate)}</dd></div>}
                {project.address && <div className="col-span-2 sm:col-span-3"><dt className="text-xs text-muted">Address</dt><dd className="font-medium text-ink">{project.address}</dd></div>}
              </dl>
              {project.amenities.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {project.amenities.map((a) => <span key={a} className="chip border-accent-line bg-accent-wash text-accent">{a}</span>)}
                </div>
              )}
            </div>
            {project.latitude != null && project.longitude != null && (
              <div className="overflow-hidden rounded-xl border border-line">
                <MapView
                  markers={[{ id: project.id, title: project.name, reference: "", lat: project.latitude, lng: project.longitude, status: "AVAILABLE", price: "", href: "#" } satisfies MapMarker]}
                  height={200}
                  single
                  zoom={15}
                />
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Media */}
      {canManage && (
        <Section title="Media — photos, floor plans & brochures" className="mb-6">
          <ProjectMediaManager projectId={project.id} items={project.media} />
        </Section>
      )}

      {/* Price list */}
      <Section title="Unit types & price list" className="mb-6">
        {unitTypes.length === 0 ? (
          <p className="text-sm text-muted">{canManage ? "Add a unit type (with a base price) before generating units." : "No unit types defined yet."}</p>
        ) : (
          <Table head={["Type", "Beds", "Size", "Floors", "Per floor", "Base price", "Floor rise"]}>
            {unitTypes.map((t) => (
              <tr key={t.id} className="hover:bg-line-soft">
                <Td className="font-medium text-ink">{t.name}{t.tower ? <span className="ml-1 text-xs text-muted">· {t.tower}</span> : null}</Td>
                <Td className="text-muted">{t.bedrooms ?? "—"}</Td>
                <Td className="text-muted">{t.areaValue ? `${t.areaValue} ${humanize(t.areaUnit)}` : "—"}</Td>
                <Td className="text-muted">{t.floorFrom != null && t.floorTo != null ? `${t.floorFrom}–${t.floorTo}` : "—"}</Td>
                <Td className="text-muted">{t.unitsPerFloor ?? "—"}</Td>
                <Td className="font-medium">{money(t.basePrice)}</Td>
                <Td className="text-muted">{toNumber(t.floorRise) ? `+${money(t.floorRise)}/floor` : "—"}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      {/* Inventory */}
      <Section title={`Inventory${total > UNIT_CAP ? ` (showing ${UNIT_CAP} of ${total})` : ""}`}>
        {units.length === 0 ? (
          <EmptyState title="No units yet" hint={canManage ? "Use “Generate units” to create the inventory." : "No units have been generated yet."} />
        ) : (
          <Table head={["Unit", "Tower", "Floor", "Type", "Dealer", "Price", "Status", ...(canManage ? [""] : [])]}>
            {units.map((u) => (
              <tr key={u.id} className="hover:bg-line-soft">
                <Td><Link href={`/properties/${u.id}`} className="font-semibold text-ink hover:text-accent">{u.reference}</Link></Td>
                <Td className="text-muted">{u.tower ?? "—"}</Td>
                <Td className="text-muted">{u.floorNumber ?? "—"}</Td>
                <Td className="text-muted">{u.unitType?.name ?? "—"}</Td>
                <Td className="text-muted">{u.dealer?.name ?? "—"}</Td>
                <Td className="font-medium">{u.salePrice != null ? money(u.salePrice) : "—"}</Td>
                <Td><StatusBadge status={u.status} /></Td>
                {canManage && <Td><UnitActions unit={{ id: u.id, reference: u.reference, salePrice: toNumber(u.salePrice), status: u.status }} /></Td>}
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </div>
  );
}
