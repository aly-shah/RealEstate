import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCompanyUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { fmtDate, humanize } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Table, Td } from "@/components/ui/Table";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { FilterBar } from "@/components/ui/FilterBar";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { parsePage } from "@/lib/pagination";
import { DocumentForm } from "./DocumentForm";
import { verifyDocument } from "./actions";

const TYPES = ["CNIC_PASSPORT", "PROPERTY_DOCUMENT", "OWNERSHIP_DOCUMENT", "SALE_AGREEMENT", "RENTAL_AGREEMENT", "PAYMENT_RECEIPT", "DEALER_DOCUMENT", "CLIENT_DOCUMENT", "OTHER"] as const;

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; status?: string; page?: string; pageSize?: string }>;
}) {
  const user = await requireCompanyUser();
  const sp = await searchParams;
  const { page, pageSize, skip } = parsePage(sp);
  const canVerify = can(user.role, "assignLeadsCalendars");
  const now = new Date();
  const soon = new Date(now.getTime() + 30 * 86400000);

  const where: Prisma.DocumentWhereInput = {
    companyId: user.companyId,
    ...(user.role === "DEALER" ? { dealer: { userId: user.id } } : {}),
    ...(sp.type ? { type: sp.type as Prisma.DocumentWhereInput["type"] } : {}),
    ...(sp.status ? { verification: sp.status as Prisma.DocumentWhereInput["verification"] } : {}),
  };

  const [documents, total, properties] = await Promise.all([
    prisma.document.findMany({
      where,
      include: { property: true, uploadedBy: true },
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
    }),
    prisma.document.count({ where }),
    prisma.property.findMany({ where: { companyId: user.companyId }, select: { id: true, title: true, reference: true }, take: 200 }),
  ]);

  return (
    <div>
      <PageHeader eyebrow="Records" title="Documents" subtitle="All paperwork in one place — verification status and expiry tracked." />

      {can(user.role, "manageDocuments") && <DocumentForm properties={properties} />}

      <FilterBar
        filters={[
          { key: "type", label: "Type", options: TYPES },
          { key: "status", label: "Status", options: ["PENDING", "VERIFIED", "REJECTED"] },
        ]}
      />

      {documents.length === 0 ? (
        <EmptyState title="No documents" hint="Upload IDs, agreements and receipts here." />
      ) : (
        <>
          <Table head={["Document", "Type", "Linked to", "Expiry", "Status", ""]}>
            {documents.map((d) => {
              const expiringSoon = d.expiryDate && d.expiryDate <= soon && d.expiryDate >= now;
              const expired = d.expiryDate && d.expiryDate < now;
              return (
                <tr key={d.id} className="hover:bg-line-soft">
                  <Td>
                    <a href={d.url} target="_blank" rel="noopener noreferrer" className="font-medium text-ink hover:text-accent">{d.name}</a>
                    <div className="text-xs text-muted">by {d.uploadedBy?.name ?? "—"}</div>
                  </Td>
                  <Td className="text-xs">{humanize(d.type)}</Td>
                  <Td className="text-xs">{d.property?.reference ?? "—"}</Td>
                  <Td className="text-xs">
                    {fmtDate(d.expiryDate)}
                    {expired && <Badge tone="danger">Expired</Badge>}
                    {expiringSoon && <Badge tone="warn">Soon</Badge>}
                  </Td>
                  <Td><StatusBadge status={d.verification} /></Td>
                  <Td>
                    {canVerify && d.verification === "PENDING" && (
                      <div className="flex gap-1">
                        <form action={verifyDocument}><input type="hidden" name="id" value={d.id} /><input type="hidden" name="status" value="VERIFIED" /><button className="btn-ghost px-2 py-1 text-xs">✓</button></form>
                        <form action={verifyDocument}><input type="hidden" name="id" value={d.id} /><input type="hidden" name="status" value="REJECTED" /><button className="btn-ghost px-2 py-1 text-xs">✕</button></form>
                      </div>
                    )}
                  </Td>
                </tr>
              );
            })}
          </Table>
          <Pagination total={total} page={page} pageSize={pageSize} />
        </>
      )}
    </div>
  );
}
