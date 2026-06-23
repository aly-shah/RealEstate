import { requireCapability } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { humanize } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { EmptyState } from "@/components/ui/EmptyState";
import { totalPct } from "@/lib/payment-plan";
import { PaymentPlanForm } from "./PaymentPlanForm";
import { DeletePlanButton } from "./DeletePlanButton";

export default async function PaymentPlansPage() {
  const user = await requireCapability("viewCompanyReports");

  const plans = await prisma.paymentPlanTemplate.findMany({
    where: { companyId: user.companyId! },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, name: true, description: true,
      milestones: { orderBy: { order: "asc" }, select: { id: true, label: true, pct: true, type: true, count: true, firstDueMonths: true, intervalMonths: true } },
    },
  });

  return (
    <div>
      <PageHeader
        eyebrow="Finance"
        title="Payment plans"
        subtitle="Installment templates applied to a booking when it's approved."
        action={<PaymentPlanForm />}
      />

      {plans.length === 0 ? (
        <EmptyState title="No payment plans yet" hint="Create a plan (e.g. 10% booking, 10% confirmation, 80% over 36 months)." />
      ) : (
        <div className="space-y-5">
          {plans.map((p) => {
            const sum = totalPct(p.milestones.map((m) => ({ pct: Number(m.pct) })));
            return (
              <Section key={p.id} title={p.name} action={<DeletePlanButton id={p.id} />}>
                {p.description && <p className="mb-3 text-sm text-muted">{p.description}</p>}
                <ul className="divide-y divide-line-soft text-sm">
                  {p.milestones.map((m) => (
                    <li key={m.id} className="flex items-center justify-between py-2">
                      <span className="font-medium text-ink">{m.label}</span>
                      <span className="text-muted">
                        {Number(m.pct)}% · {humanize(m.type)}
                        {m.count > 1 ? ` · ${m.count}× every ${m.intervalMonths}mo` : ""}
                        {m.firstDueMonths ? ` · from +${m.firstDueMonths}mo` : " · on approval"}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className={`mt-2 text-xs ${sum === 100 ? "text-ok" : "text-warn"}`}>Total: {sum}%{sum !== 100 ? " (doesn't sum to 100%)" : ""}</p>
              </Section>
            );
          })}
        </div>
      )}
    </div>
  );
}
