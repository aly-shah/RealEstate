import Link from "next/link";
import { requireCompanyUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { money, toNumber, humanize } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ProjectWizard } from "./ProjectWizard";

export const PROJECT_STATUS_TONE: Record<string, "ok" | "accent" | "warn" | "neutral" | "danger"> = {
  PLANNING: "neutral",
  PRE_LAUNCH: "warn",
  SELLING: "ok",
  SOLD_OUT: "accent",
  COMPLETED: "accent",
  ON_HOLD: "danger",
};

export default async function ProjectsPage() {
  const user = await requireCompanyUser();
  const canManage = can(user.role, "viewCompanyReports");

  const [projects, agg] = await Promise.all([
    prisma.project.findMany({
      where: { companyId: user.companyId },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, city: true, area: true, status: true, isOffPlan: true },
    }),
    // One groupBy gives per-project, per-status unit counts + value.
    prisma.property.groupBy({
      by: ["projectId", "status"],
      where: { companyId: user.companyId, projectId: { not: null } },
      _count: { _all: true },
      _sum: { salePrice: true },
    }),
  ]);

  type Roll = { total: number; available: number; sold: number; reserved: number; gross: number; soldValue: number };
  const rollups = new Map<string, Roll>();
  for (const g of agg) {
    if (!g.projectId) continue;
    const r = rollups.get(g.projectId) ?? { total: 0, available: 0, sold: 0, reserved: 0, gross: 0, soldValue: 0 };
    const n = g._count._all;
    const val = toNumber(g._sum.salePrice);
    r.total += n;
    r.gross += val;
    if (g.status === "AVAILABLE") r.available += n;
    else if (g.status === "SOLD") { r.sold += n; r.soldValue += val; }
    else if (g.status === "RESERVED" || g.status === "UNDER_NEGOTIATION") r.reserved += n;
    rollups.set(g.projectId, r);
  }

  return (
    <div>
      <PageHeader
        eyebrow="Inventory"
        title="Projects"
        subtitle="Your developments and their unit inventory."
        action={canManage ? <ProjectWizard /> : null}
      />

      {projects.length === 0 ? (
        <EmptyState
          title="No projects yet"
          hint={canManage ? "Create a project, add unit types, then generate its inventory." : "Your team hasn't added any projects yet."}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => {
            const r = rollups.get(p.id) ?? { total: 0, available: 0, sold: 0, reserved: 0, gross: 0, soldValue: 0 };
            const soldPct = r.total ? Math.round((r.sold / r.total) * 100) : 0;
            return (
              <Link key={p.id} href={`/projects/${p.id}`} className="surface group p-5 transition hover:-translate-y-1 hover:shadow-[var(--shadow-pop)]">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-ink group-hover:text-accent">{p.name}</p>
                    <p className="text-xs text-muted">{[p.area, p.city].filter(Boolean).join(", ") || "—"}{p.isOffPlan ? " · Off-plan" : ""}</p>
                  </div>
                  <Badge tone={PROJECT_STATUS_TONE[p.status] ?? "neutral"}>{humanize(p.status)}</Badge>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <div><p className="text-lg font-bold text-ink">{r.total}</p><p className="text-[10px] uppercase tracking-wide text-muted">Units</p></div>
                  <div><p className="text-lg font-bold text-ok">{r.available}</p><p className="text-[10px] uppercase tracking-wide text-muted">Available</p></div>
                  <div><p className="text-lg font-bold text-accent">{r.sold}</p><p className="text-[10px] uppercase tracking-wide text-muted">Sold</p></div>
                </div>

                <div className="mt-3">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-line-soft">
                    <div className="h-full rounded-full brand-gradient" style={{ width: `${soldPct}%` }} />
                  </div>
                  <p className="mt-1.5 text-xs text-muted">{money(r.gross)} inventory{r.sold ? ` · ${money(r.soldValue)} sold` : ""}</p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
