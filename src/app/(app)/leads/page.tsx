import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCompanyUser } from "@/lib/session";
import { leadScope } from "@/lib/scope";
import { compactMoney, humanize, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Table, Td } from "@/components/ui/Table";
import { StatusBadge } from "@/components/ui/Badge";
import { FilterBar } from "@/components/ui/FilterBar";
import { EmptyState } from "@/components/ui/EmptyState";

const STAGES = ["NEW", "CONTACTED", "INTERESTED", "SITE_VISIT", "PROPERTY_SHOWN", "NEGOTIATION", "TOKEN_BOOKING", "PAYMENT", "CLOSED_WON", "CLOSED_LOST"] as const;

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; stage?: string }>;
}) {
  const user = await requireCompanyUser();
  const sp = await searchParams;
  const scope = leadScope(user);

  const where: Prisma.LeadWhereInput = {
    ...scope,
    ...(sp.stage ? { stage: sp.stage as Prisma.LeadWhereInput["stage"] } : {}),
    ...(sp.q ? { client: { name: { contains: sp.q, mode: "insensitive" } } } : {}),
  };

  const [leads, grouped] = await Promise.all([
    prisma.lead.findMany({
      where,
      include: { client: true, agent: true, property: true },
      orderBy: { updatedAt: "desc" },
      take: 100,
    }),
    prisma.lead.groupBy({ by: ["stage"], where: scope, _count: { _all: true } }),
  ]);

  const counts = Object.fromEntries(grouped.map((g) => [g.stage, g._count._all]));

  return (
    <div>
      <PageHeader
        eyebrow="CRM"
        title="Leads"
        subtitle="Move every enquiry through the pipeline — nothing falls through the cracks."
        action={<Link href="/leads/new" className="btn-accent">+ New lead</Link>}
      />

      {/* Pipeline summary */}
      <div className="mb-5 flex gap-1 overflow-x-auto">
        {STAGES.map((s, i) => (
          <Link
            key={s}
            href={`/leads?stage=${s}`}
            className={`flex min-w-[110px] flex-1 flex-col gap-1 border px-3 py-2 text-xs transition ${
              i === 0 ? "rounded-l-lg" : ""
            } ${i === STAGES.length - 1 ? "rounded-r-lg" : ""} ${
              s === "CLOSED_WON"
                ? "border-ink bg-ink"
                : "border-line bg-white hover:bg-line-soft"
            }`}
          >
            <span className={`font-medium ${s === "CLOSED_WON" ? "text-white/60" : "text-muted"}`}>{humanize(s)}</span>
            <span className={`text-lg font-semibold ${s === "CLOSED_WON" ? "text-white" : "text-ink"}`}>{counts[s] ?? 0}</span>
          </Link>
        ))}
      </div>

      <FilterBar searchPlaceholder="Search client…" filters={[{ key: "stage", label: "Stage", options: STAGES }]} />

      {leads.length === 0 ? (
        <EmptyState title="No leads found" hint="Capture an enquiry to start the pipeline." />
      ) : (
        <Table head={["Client", "Stage", "Source", "Property", "Budget", "Agent", "Updated"]}>
          {leads.map((l) => (
            <tr key={l.id} className="hover:bg-line-soft">
              <Td>
                <Link href={`/leads/${l.id}`} className="font-medium text-ink hover:text-accent">{l.client?.name ?? "Unnamed"}</Link>
                <div className="text-xs text-muted">{l.client?.phone ?? ""}</div>
              </Td>
              <Td><StatusBadge status={l.stage} /></Td>
              <Td>{humanize(l.source)}</Td>
              <Td className="max-w-[180px] truncate text-xs">{l.property?.title ?? l.prefArea ?? "—"}</Td>
              <Td className="whitespace-nowrap text-xs">{l.budgetMax ? `≤ ${compactMoney(l.budgetMax)}` : "—"}</Td>
              <Td className="text-xs">{l.agent?.name ?? <span className="text-warn">Unassigned</span>}</Td>
              <Td className="text-xs text-muted">{fmtDate(l.updatedAt)}</Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
