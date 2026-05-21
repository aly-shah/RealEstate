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

const TYPES = ["RESIDENTIAL", "COMMERCIAL", "PLOT", "APARTMENT", "VILLA", "SHOP", "OFFICE"] as const;
const STATUSES = ["AVAILABLE", "RESERVED", "UNDER_NEGOTIATION", "RENTED", "SOLD", "INACTIVE", "PENDING_VERIFICATION"] as const;

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; type?: string }>;
}) {
  const user = await requireCompanyUser();
  const sp = await searchParams;
  const scope = await propertyScope(user);

  const where: Prisma.PropertyWhereInput = {
    ...scope,
    ...(sp.status ? { status: sp.status as Prisma.PropertyWhereInput["status"] } : {}),
    ...(sp.type ? { type: sp.type as Prisma.PropertyWhereInput["type"] } : {}),
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

  const properties = await prisma.property.findMany({
    where,
    include: { dealer: true, _count: { select: { agents: true, leads: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div>
      <PageHeader
        eyebrow="Inventory"
        title="Properties"
        subtitle="Every listing the business holds — for sale, for rent, or both."
        action={
          can(user.role, "manageProperties") ? (
            <Link href="/properties/new" className="btn-accent">+ Add property</Link>
          ) : null
        }
      />

      <FilterBar
        searchPlaceholder="Search title, ref, area…"
        filters={[
          { key: "status", label: "Status", options: STATUSES },
          { key: "type", label: "Type", options: TYPES },
        ]}
      />

      {properties.length === 0 ? (
        <EmptyState title="No properties found" hint="Try clearing filters, or add your first listing." />
      ) : (
        <Table head={["Reference", "Property", "Type", "Price", "Status", "Engagement"]}>
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
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
