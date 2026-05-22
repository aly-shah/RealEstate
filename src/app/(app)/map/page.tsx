import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCompanyUser } from "@/lib/session";
import { propertyScope } from "@/lib/scope";
import { compactMoney, humanize } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { FilterBar } from "@/components/ui/FilterBar";
import { EmptyState } from "@/components/ui/EmptyState";
import { MapView, type MapMarker } from "@/components/map/MapView";
import { MAP_LEGEND } from "@/lib/theme";

const TYPES = ["RESIDENTIAL", "COMMERCIAL", "PLOT", "APARTMENT", "VILLA", "SHOP", "OFFICE"] as const;
const STATUSES = ["AVAILABLE", "RESERVED", "UNDER_NEGOTIATION", "RENTED", "SOLD", "INACTIVE", "PENDING_VERIFICATION"] as const;

export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; type?: string }>;
}) {
  const user = await requireCompanyUser();
  const sp = await searchParams;
  const scope = await propertyScope(user);

  const where: Prisma.PropertyWhereInput = {
    ...scope,
    latitude: { not: null },
    longitude: { not: null },
    ...(sp.status ? { status: sp.status as Prisma.PropertyWhereInput["status"] } : {}),
    ...(sp.type ? { type: sp.type as Prisma.PropertyWhereInput["type"] } : {}),
  };

  const properties = await prisma.property.findMany({
    where,
    select: { id: true, title: true, reference: true, status: true, salePrice: true, monthlyRent: true, latitude: true, longitude: true },
    take: 500,
  });

  const markers: MapMarker[] = properties.map((p) => ({
    id: p.id,
    title: p.title,
    reference: p.reference,
    lat: p.latitude!,
    lng: p.longitude!,
    status: p.status,
    price: p.salePrice ? compactMoney(p.salePrice) : p.monthlyRent ? `${compactMoney(p.monthlyRent)}/mo` : "",
    href: `/properties/${p.id}`,
  }));

  return (
    <div>
      <PageHeader
        eyebrow="Inventory"
        title="Property map"
        subtitle={`${markers.length} propert${markers.length === 1 ? "y" : "ies"} plotted by location.`}
      />

      <FilterBar
        showSearch={false}
        filters={[
          { key: "status", label: "Status", options: STATUSES },
          { key: "type", label: "Type", options: TYPES },
        ]}
      />

      {markers.length === 0 ? (
        <EmptyState title="No mapped properties" hint="Properties need a location pin to appear on the map." />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2">
            {MAP_LEGEND.map((l) => (
              <span key={l.label} className="flex items-center gap-1.5 text-xs text-slate">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: l.color }} />
                {l.label}
              </span>
            ))}
          </div>
          <MapView markers={markers} height="70vh" />
        </>
      )}
    </div>
  );
}
