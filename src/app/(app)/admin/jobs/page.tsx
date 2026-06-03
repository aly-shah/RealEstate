import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { fmtDateTime, humanize } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { StatCard } from "@/components/ui/StatCard";
import { Table, Td } from "@/components/ui/Table";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { FilterBar } from "@/components/ui/FilterBar";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { parsePage } from "@/lib/pagination";
import { requeueJob, deleteJob, enqueueEcho } from "./actions";

const STATUSES = ["QUEUED", "RUNNING", "DONE", "FAILED"] as const;

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; type?: string; page?: string; pageSize?: string }>;
}) {
  const user = await requireUser();
  if (user.role !== "SUPER_ADMIN") redirect("/dashboard");
  const sp = await searchParams;
  const { page, pageSize, skip } = parsePage(sp);

  const where: Prisma.JobWhereInput = {
    ...(sp.status ? { status: sp.status as Prisma.JobWhereInput["status"] } : {}),
    ...(sp.type ? { type: sp.type } : {}),
  };

  const [jobs, total, counts, types] = await Promise.all([
    prisma.job.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
    }),
    prisma.job.count({ where }),
    prisma.job.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.job.groupBy({ by: ["type"], _count: { _all: true } }),
  ]);

  const byStatus = Object.fromEntries(counts.map((c) => [c.status, c._count._all]));
  const typeOptions = types.map((t) => ({ value: t.type, label: `${t.type} (${t._count._all})` }));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Platform"
        title="Jobs"
        subtitle="Background queue + cron sweeps. The /api/jobs/tick cron drains this."
        action={
          <form action={enqueueEcho}>
            <button className="btn-ghost text-sm" title="Enqueue a test.echo job">
              + Test job
            </button>
          </form>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Queued" value={byStatus.QUEUED ?? 0} tone="accent" />
        <StatCard label="Running" value={byStatus.RUNNING ?? 0} tone="ink" />
        <StatCard label="Done (all-time)" value={byStatus.DONE ?? 0} tone="ok" />
        <StatCard label="Failed" value={byStatus.FAILED ?? 0} tone="danger" />
      </div>

      <FilterBar
        showSearch={false}
        filters={[
          { key: "status", label: "Status", options: STATUSES },
          { key: "type", label: "Type", options: typeOptions },
        ]}
      />

      {jobs.length === 0 ? (
        <EmptyState
          title="No jobs match"
          hint="Try clearing filters. The first thing in here will be the next cron tick."
        />
      ) : (
        <>
          <Table head={["Type", "Status", "Attempts", "Created", "Started", "Finished", "Error / Result", ""]}>
            {jobs.map((j) => {
              const showError = j.status === "FAILED" && j.error;
              const showResult = j.status === "DONE" && j.result != null;
              return (
                <tr key={j.id} className="hover:bg-line-soft">
                  <Td>
                    <span className="font-medium text-ink" data-keep-latin>{j.type}</span>
                    {j.companyId && (
                      <div className="text-[10px] text-muted" data-keep-latin>tenant {j.companyId.slice(-6)}</div>
                    )}
                  </Td>
                  <Td><StatusBadge status={j.status} /></Td>
                  <Td className="text-xs">
                    {j.attempts} / {j.maxAttempts}
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-muted">{fmtDateTime(j.createdAt)}</Td>
                  <Td className="whitespace-nowrap text-xs text-muted">{j.startedAt ? fmtDateTime(j.startedAt) : "—"}</Td>
                  <Td className="whitespace-nowrap text-xs text-muted">{j.finishedAt ? fmtDateTime(j.finishedAt) : "—"}</Td>
                  <Td className="max-w-[260px]">
                    {showError && <span className="text-xs text-danger">{j.error}</span>}
                    {showResult && (
                      <details>
                        <summary className="cursor-pointer text-xs text-accent">result</summary>
                        <pre className="mt-1 max-h-32 overflow-auto rounded-md bg-line-soft px-2 py-1 text-[10px] text-slate">
                          {JSON.stringify(j.result, null, 2)}
                        </pre>
                      </details>
                    )}
                    {!showError && !showResult && (
                      <span className="text-xs text-muted">{humanize(j.status)}</span>
                    )}
                  </Td>
                  <Td>
                    {j.status === "FAILED" && (
                      <form action={requeueJob} className="inline-block">
                        <input type="hidden" name="id" value={j.id} />
                        <button className="btn-ghost px-2 py-1 text-xs">Re-queue</button>
                      </form>
                    )}
                    <form action={deleteJob} className="inline-block">
                      <input type="hidden" name="id" value={j.id} />
                      <button className="text-xs text-muted hover:text-danger" title="Delete" aria-label={`Delete ${j.id}`}>
                        ✕
                      </button>
                    </form>
                  </Td>
                </tr>
              );
            })}
          </Table>
          <Pagination total={total} page={page} pageSize={pageSize} />
        </>
      )}

      <Section title="Cron status">
        <p className="text-sm text-slate">
          The queue + trial sweeps run when the VPS crontab hits <code className="kbd">POST /api/jobs/tick</code> with the{" "}
          <code className="kbd">JOBS_TICK_TOKEN</code> bearer. See <code className="kbd">deploy/JOBS.md</code> for install +
          troubleshooting. If "Queued" count keeps climbing, the cron isn't firing or the token doesn't match.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <Badge tone="neutral">env: JOBS_TICK_TOKEN</Badge>
          <Badge tone="neutral">env: WHATSAPP_VERIFY_TOKEN</Badge>
          <Badge tone="neutral">env: WHATSAPP_APP_SECRET</Badge>
        </div>
      </Section>
    </div>
  );
}
