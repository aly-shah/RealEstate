import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/session";
import { fmtDateTime, humanize } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Table, Td } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { FilterBar } from "@/components/ui/FilterBar";
import { EmptyState } from "@/components/ui/EmptyState";

const ENTITY_TYPES = ["PROPERTY", "LEAD", "DEAL", "COMMISSION", "USER", "DOCUMENT", "PAYMENT", "COMMISSION_RULE"] as const;

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string; user?: string }>;
}) {
  const me = await requireCapability("viewCompanyReports");
  const companyId = me.companyId!;
  const sp = await searchParams;

  const where: Prisma.ActivityLogWhereInput = {
    companyId,
    ...(sp.entity ? { entityType: sp.entity } : {}),
    ...(sp.user ? { userId: sp.user } : {}),
  };

  const [logs, users] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      include: { user: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.user.findMany({ where: { companyId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div>
      <PageHeader
        eyebrow="Audit"
        title="Activity log"
        subtitle="Every meaningful action across the company — who changed what, and when."
      />

      <FilterBar
        showSearch={false}
        filters={[
          { key: "entity", label: "Entity", options: ENTITY_TYPES },
          { key: "user", label: "User", options: users.map((u) => ({ value: u.id, label: u.name })) },
        ]}
      />

      {logs.length === 0 ? (
        <EmptyState title="No activity recorded" hint="Actions like creating a lead or closing a deal will show up here." />
      ) : (
        <Table head={["When", "User", "Action", "Entity", "Summary"]}>
          {logs.map((l) => (
            <tr key={l.id} className="hover:bg-line-soft">
              <Td className="whitespace-nowrap text-xs text-muted">{fmtDateTime(l.createdAt)}</Td>
              <Td className="text-sm">{l.user?.name ?? "System"}</Td>
              <Td><Badge tone="neutral">{l.action}</Badge></Td>
              <Td className="text-xs text-muted">{humanize(l.entityType)}</Td>
              <Td className="text-sm text-ink">{l.summary}</Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
