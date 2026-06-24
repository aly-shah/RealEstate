import { Section } from "@/components/ui/Section";
import { StatCard } from "@/components/ui/StatCard";
import { Table, Td } from "@/components/ui/Table";
import { money, compactMoney } from "@/lib/format";
import type { CompanyForecast, AgentForecast } from "@/lib/commissions/forecast";

/**
 * Owner/admin commission forecast: current payout liability + a probability-
 * weighted 30/60/90-day pipeline, with a per-agent breakdown. "Weighted" applies
 * each deal's stage win-probability; "gross" is the un-discounted ceiling.
 */
export function OwnerForecast({ data }: { data: CompanyForecast }) {
  return (
    <div className="mb-8 space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Current liability" value={compactMoney(data.liability)} tone="danger" sub="Approved, not yet paid" />
        <StatCard label="Weighted forecast" value={compactMoney(data.weightedTotal)} tone="accent" sub="Probability-adjusted" />
        <StatCard label="Gross pipeline" value={compactMoney(data.grossPipeline)} tone="ink" sub="If every deal closed" />
        <StatCard label="Open deals" value={data.openDeals} sub="In the pipeline" />
      </div>

      <Section title="Forecast by close window">
        {data.openDeals === 0 ? (
          <p className="text-sm text-muted">No open deals in the pipeline yet.</p>
        ) : (
          <Table head={["Window", "Deals", "Gross", "Weighted"]}>
            {data.buckets.map((b) => (
              <tr key={b.key} className="hover:bg-line-soft">
                <Td className="font-medium text-ink">{b.label}</Td>
                <Td className="text-muted">{b.deals}</Td>
                <Td>{money(b.gross)}</Td>
                <Td className="font-semibold text-accent">{money(b.weighted)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      {data.byAgent.length > 0 && (
        <Section title="Forecast by agent">
          <Table head={["Agent", "Open deals", "Gross", "Weighted"]}>
            {data.byAgent.map((a) => (
              <tr key={a.id} className="hover:bg-line-soft">
                <Td className="font-medium text-ink">{a.name}</Td>
                <Td className="text-muted">{a.openDeals}</Td>
                <Td>{money(a.gross)}</Td>
                <Td className="font-semibold text-accent">{money(a.weighted)}</Td>
              </tr>
            ))}
          </Table>
        </Section>
      )}
    </div>
  );
}

/** Agent's own earnings + forecast, with their rank in the company. */
export function AgentForecastCards({ data }: { data: AgentForecast }) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
      <StatCard label="Paid to you" value={compactMoney(data.paid)} tone="ok" />
      <StatCard label="Pending" value={compactMoney(data.pending)} tone="gold" sub="Approved, awaiting payout" />
      <StatCard
        label="Forecast"
        value={compactMoney(data.weightedForecast)}
        tone="accent"
        sub={`${data.openDeals} open deal${data.openDeals === 1 ? "" : "s"}`}
      />
      <StatCard label="Your rank" value={`#${data.rank}`} tone="ink" sub={`of ${data.totalAgents} agents`} />
    </div>
  );
}
