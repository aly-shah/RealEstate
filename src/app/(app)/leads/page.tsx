import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCompanyUser } from "@/lib/session";
import { leadScope } from "@/lib/scope";
import { compactMoney, humanize, fmtDate } from "@/lib/format";
import { can } from "@/lib/rbac";
import { PageHeader } from "@/components/ui/PageHeader";
import { Table, Td } from "@/components/ui/Table";
import { StatusBadge } from "@/components/ui/Badge";
import { FilterBar } from "@/components/ui/FilterBar";
import { EmptyState } from "@/components/ui/EmptyState";
import { KeysetPagination } from "@/components/ui/KeysetPagination";
import { parseKeyset, keysetWhere, keysetOrderBy, sliceKeyset } from "@/lib/pagination";
import { SavedViews } from "@/components/ui/SavedViews";
import { scoreLead } from "@/lib/lead-score";
import { leadHealth } from "@/lib/lead-health";
import { LeadHealthBadge } from "@/components/lead/LeadHealthBadge";
import { LeadScoreBadge } from "@/components/lead/LeadScoreBadge";

const STAGES = ["NEW", "CONTACTED", "INTERESTED", "SITE_VISIT", "PROPERTY_SHOWN", "NEGOTIATION", "TOKEN_BOOKING", "PAYMENT", "CLOSED_WON", "CLOSED_LOST"] as const;

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; stage?: string; after?: string; before?: string; pageSize?: string }>;
}) {
  const user = await requireCompanyUser();
  const sp = await searchParams;
  const scope = leadScope(user);
  // Keyset (cursor) paging on updatedAt — index-seek at any depth, no OFFSET
  // scan. Bidirectional via ?after= / ?before=. See lib/pagination.ts.
  const params = parseKeyset(sp);

  const filtered: Prisma.LeadWhereInput = {
    ...scope,
    ...(sp.stage ? { stage: sp.stage as Prisma.LeadWhereInput["stage"] } : {}),
    ...(sp.q ? { client: { name: { contains: sp.q, mode: "insensitive" } } } : {}),
  };
  const where: Prisma.LeadWhereInput = {
    AND: [filtered, keysetWhere(params, "updatedAt") as Prisma.LeadWhereInput],
  };

  const [rows, grouped] = await Promise.all([
    prisma.lead.findMany({
      where,
      include: {
        client: true,
        agent: true,
        property: true,
        // Pull just what scoring + health need; the showings select stays cheap
        // (PK only) and the count is one extra index hit per lead.
        showings: { select: { interestLevel: true } },
        _count: {
          select: {
            events: { where: { startAt: { gt: new Date() }, status: "SCHEDULED" } },
          },
        },
      },
      orderBy: keysetOrderBy(params, "updatedAt") as Prisma.LeadOrderByWithRelationInput[],
      take: params.take + 1, // over-fetch one to detect a further page
    }),
    prisma.lead.groupBy({ by: ["stage"], where: scope, _count: { _all: true } }),
  ]);

  const { items: leads, prevCursor, nextCursor } = sliceKeyset(rows, params, (l) => l.updatedAt);

  // Lift the highest non-null interest level seen across showings. HIGH wins
  // over MEDIUM wins over LOW wins over NONE.
  const interestRank: Record<string, number> = { HIGH: 4, MEDIUM: 3, LOW: 2, NONE: 1 };
  const decorated = leads.map((l) => {
    const topInterest = l.showings.reduce<null | "HIGH" | "MEDIUM" | "LOW" | "NONE">(
      (best, s) =>
        s.interestLevel && (best == null || interestRank[s.interestLevel] > interestRank[best])
          ? (s.interestLevel as "HIGH" | "MEDIUM" | "LOW" | "NONE")
          : best,
      null,
    );
    const score = scoreLead({
      stage: l.stage,
      source: l.source,
      hasBudget: !!(l.budgetMin || l.budgetMax),
      hasProperty: !!l.propertyId,
      updatedAt: l.updatedAt,
      hasShowing: l.showings.length > 0,
      topInterest,
      override: l.scoreOverride,
    });
    const health = leadHealth({
      stage: l.stage,
      lastContactedAt: l.lastContactedAt,
      createdAt: l.createdAt,
      unassigned: !l.agentId,
      hasFutureEvent: l._count.events > 0,
    });
    return { l, score, health };
  });

  const counts = Object.fromEntries(grouped.map((g) => [g.stage, g._count._all]));

  return (
    <div>
      <PageHeader
        eyebrow="CRM"
        title="Leads"
        subtitle="Move every enquiry through the pipeline — nothing falls through the cracks."
        action={
          <div className="flex items-center gap-2">
            {can(user.role, "assignLeadsCalendars") && (
              <Link href="/leads/import" className="btn-ghost">↥ Import</Link>
            )}
            <Link href="/leads/new" className="btn-accent">+ New lead</Link>
          </div>
        }
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

      {/* FilterBar already has bottom margin; the SavedViews chip sits inline-right. */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <FilterBar searchPlaceholder="Search client…" filters={[{ key: "stage", label: "Stage", options: STAGES }]} />
        </div>
        <div className="mb-4 self-center"><SavedViews /></div>
      </div>

      {decorated.length === 0 ? (
        <EmptyState title="No leads found" hint="Capture an enquiry to start the pipeline." />
      ) : (
        <>
          <Table head={["Client", "Stage", "Score", "Health", "Source", "Property", "Budget", "Agent", "Updated"]}>
            {decorated.map(({ l, score, health }) => (
              <tr key={l.id} className="hover:bg-line-soft">
                <Td>
                  <Link href={`/leads/${l.id}`} className="font-medium text-ink hover:text-accent">{l.client?.name ?? "Unnamed"}</Link>
                  <div className="text-xs text-muted">{l.client?.phone ?? ""}</div>
                </Td>
                <Td><StatusBadge status={l.stage} /></Td>
                <Td>
                  <LeadScoreBadge band={score.band} score={score.score} overridden={score.overridden} reasons={score.reasons} />
                </Td>
                <Td>
                  <LeadHealthBadge health={health.health} reasons={health.reasons} />
                </Td>
                <Td>{humanize(l.source)}</Td>
                <Td className="max-w-[180px] truncate text-xs">{l.property?.title ?? l.prefArea ?? "—"}</Td>
                <Td className="whitespace-nowrap text-xs">{l.budgetMax ? `≤ ${compactMoney(l.budgetMax)}` : "—"}</Td>
                <Td className="text-xs">{l.agent?.name ?? <span className="text-warn">Unassigned</span>}</Td>
                <Td className="text-xs text-muted">{fmtDate(l.updatedAt)}</Td>
              </tr>
            ))}
          </Table>
          <KeysetPagination
            prevCursor={prevCursor}
            nextCursor={nextCursor}
            pageSize={params.take}
            count={leads.length}
          />
        </>
      )}
    </div>
  );
}
