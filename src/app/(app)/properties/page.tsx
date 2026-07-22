import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCompanyUser } from "@/lib/session";
import { propertyScope } from "@/lib/scope";
import { can } from "@/lib/rbac";
import { compactMoney, humanize } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Table, Td } from "@/components/ui/Table";
import { StatusBadge } from "@/components/ui/Badge";
import { FilterBar } from "@/components/ui/FilterBar";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { parsePage } from "@/lib/pagination";
import { SavedViews } from "@/components/ui/SavedViews";
import { QuickShareButton } from "@/components/property/QuickShareButton";
import { AddPropertyDrawer } from "@/components/property/AddPropertyDrawer";
import { PK_CITIES } from "@/lib/pk-areas";
import { ALL_PROPERTY_TYPES } from "@/lib/property-types";

const TYPES = ALL_PROPERTY_TYPES;
const STATUSES = ["AVAILABLE", "RESERVED", "UNDER_NEGOTIATION", "RENTED", "SOLD", "INACTIVE", "PENDING_VERIFICATION"] as const;

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; type?: string; city?: string; page?: string; pageSize?: string }>;
}) {
  const user = await requireCompanyUser();
  const sp = await searchParams;
  const scope = await propertyScope(user);
  const { page, pageSize, skip } = parsePage(sp);

  const where: Prisma.PropertyWhereInput = {
    ...scope,
    ...(sp.status ? { status: sp.status as Prisma.PropertyWhereInput["status"] } : {}),
    ...(sp.type ? { type: sp.type as Prisma.PropertyWhereInput["type"] } : {}),
    // City stored as free text — case-insensitive exact match keeps the
    // filter forgiving of "Karachi" vs "karachi" without needing UI tricks.
    ...(sp.city ? { city: { equals: sp.city, mode: "insensitive" } } : {}),
    ...(sp.q
      ? {
          OR: [
            { title: { contains: sp.q, mode: "insensitive" } },
            { reference: { contains: sp.q, mode: "insensitive" } },
            { area: { contains: sp.q, mode: "insensitive" } },
            { city: { contains: sp.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  // Dealers feed the Add-property drawer's dealer picker (office roles only).
  const canPickDealer = user.role === "OWNER" || user.role === "ADMIN";

  const [properties, total, dealers] = await Promise.all([
    prisma.property.findMany({
      where,
      include: { dealer: true, _count: { select: { agents: true, leads: true } } },
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
    }),
    prisma.property.count({ where }),
    canPickDealer
      ? prisma.dealer.findMany({
          where: { companyId: user.companyId },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);

  return (
    <div>
      <PageHeader
        eyebrow="Inventory"
        title="Properties"
        subtitle="Every listing the business holds — for sale, for rent, or both."
        action={
          can(user.role, "manageProperties") ? (
            <AddPropertyDrawer dealers={dealers} canPickDealer={canPickDealer} />
          ) : null
        }
      />

      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <FilterBar
            searchPlaceholder="Search title, ref, area…"
            filters={[
              { key: "status", label: "Status", options: STATUSES },
              { key: "type", label: "Type", options: TYPES },
              { key: "city", label: "City", options: PK_CITIES.map((c) => ({ value: c, label: c })) },
            ]}
          />
        </div>
        <div className="mb-4 self-center"><SavedViews /></div>
      </div>

      {properties.length === 0 ? (
        <EmptyState title="No properties found" hint="Try clearing filters, or add your first listing." />
      ) : (
        <>
          <Table head={["Reference", "Property", "Type", "Price", "Status", "Engagement", ""]}>
            {properties.map((p) => (
              <tr key={p.id} className="hover:bg-line-soft">
                <Td className="font-semibold text-ink">{p.reference}</Td>
                <Td>
                  <Link href={`/properties/${p.id}`} className="font-medium text-ink hover:text-accent">
                    {p.title}
                  </Link>
                  <div className="text-xs text-muted">{[p.area, p.city].filter(Boolean).join(", ") || "—"}</div>
                </Td>
                <Td>{humanize(p.type)}</Td>
                <Td className="whitespace-nowrap">
                  {p.salePrice ? compactMoney(p.salePrice) : ""}
                  {p.salePrice && p.monthlyRent ? " · " : ""}
                  {p.monthlyRent ? `${compactMoney(p.monthlyRent)}/mo` : ""}
                  {!p.salePrice && !p.monthlyRent ? "—" : ""}
                </Td>
                <Td><StatusBadge status={p.status} /></Td>
                <Td className="text-xs text-muted">{p._count.leads} leads · {p._count.agents} agents</Td>
                <Td className="text-end">
                  <QuickShareButton
                    reference={p.reference}
                    title={p.title}
                    slug={p.shareSlug}
                  />
                </Td>
              </tr>
            ))}
          </Table>
          <Pagination total={total} page={page} pageSize={pageSize} />
        </>
      )}
    </div>
  );
}
