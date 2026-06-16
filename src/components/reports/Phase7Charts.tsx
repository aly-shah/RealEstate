"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { COLORS } from "@/lib/theme";
import type { MonthlyRevenuePoint, SourceConversionRow, FunnelStep, AgingBucket, InventoryAgingBucket } from "@/lib/reports";

const axis = { stroke: COLORS.muted, fontSize: 11, tickLine: false, axisLine: { stroke: COLORS.line } };
const tooltipStyle = {
  border: `1px solid ${COLORS.line}`,
  borderRadius: 12,
  fontSize: 12,
  background: COLORS.paper,
  boxShadow: "0 8px 24px -12px rgba(15, 23, 42, 0.16)",
  padding: "8px 12px",
} as const;

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

/** Stacked-area: sale vs rental revenue by month. */
export function SalesVsRentalsChart({ data }: { data: MonthlyRevenuePoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="rev-sales" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6366f1" stopOpacity={0.42} />
            <stop offset="100%" stopColor="#4f46e5" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="rev-rentals" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={COLORS.ok} stopOpacity={0.34} />
            <stop offset="100%" stopColor={COLORS.ok} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={COLORS.line} vertical={false} />
        <XAxis dataKey="month" {...axis} />
        <YAxis tickFormatter={compact} width={44} {...axis} />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(v: number, name: string) => [`PKR ${compact(v)}`, name === "sales" ? "Sales" : "Rentals"]}
        />
        <Area type="monotone" dataKey="sales" stackId="rev" stroke={COLORS.accent} strokeWidth={2.5} fill="url(#rev-sales)" dot={false} />
        <Area type="monotone" dataKey="rentals" stackId="rev" stroke={COLORS.ok} strokeWidth={2.5} fill="url(#rev-rentals)" dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Paired-bar: total leads vs won, sorted by source volume. */
export function SourceConversionChart({ data }: { data: SourceConversionRow[] }) {
  const rows = data.map((r) => ({
    source: r.source.replace(/_/g, " ").toLowerCase(),
    Total: r.total,
    Won: r.won,
    pct: r.conversion,
  }));
  return (
    <ResponsiveContainer width="100%" height={Math.max(220, rows.length * 30)}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 48, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="srcWon" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#16a34a" /><stop offset="100%" stopColor="#34d399" />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={COLORS.line} horizontal={false} />
        <XAxis type="number" {...axis} allowDecimals={false} />
        <YAxis type="category" dataKey="source" width={110} {...axis} />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(v: number, name: string) => [v, name]}
          // Append conversion % to the tooltip body so the user sees it inline.
          labelFormatter={(label, payload) => {
            const row = payload?.[0]?.payload;
            return row ? `${label} · ${row.pct}% conv.` : String(label);
          }}
        />
        <Bar dataKey="Total" fill={COLORS.line} barSize={10} radius={[0, 4, 4, 0]} />
        <Bar dataKey="Won" fill="url(#srcWon)" barSize={10} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Funnel with retention % labels per stage. Drop-off lives in the gap between bars. */
export function FunnelDropoffChart({ data }: { data: FunnelStep[] }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="space-y-1.5">
      {data.map((step, i) => {
        const width = Math.round((step.count / max) * 100);
        const isCloseStage = step.stage === "CLOSED_WON";
        return (
          <div key={step.stage} className="grid grid-cols-[100px_1fr_auto] items-center gap-3 text-xs">
            <span className="truncate text-slate">{step.stage.replace(/_/g, " ").toLowerCase()}</span>
            <div className="h-5 overflow-hidden rounded-md bg-line-soft">
              <div
                className={`h-full transition-[width] ${isCloseStage ? "bg-ok" : "brand-gradient"}`}
                style={{ width: `${width}%` }}
              />
            </div>
            <span className="w-24 text-right tabular-nums">
              <span className="font-semibold text-ink">{step.count}</span>
              {i > 0 && (
                <span className={`ms-2 text-[10px] ${step.retentionPct >= 75 ? "text-ok" : step.retentionPct >= 50 ? "text-warn" : "text-danger"}`}>
                  {step.retentionPct}%
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Bucket bar for overdue aging. Reds get darker as the bucket ages. */
export function OverdueAgingChart({ data }: { data: AgingBucket[] }) {
  const tone = [COLORS.warn, "#d97706", "#b45309", "#7f1d1d"];
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={COLORS.line} vertical={false} />
        <XAxis dataKey="label" {...axis} />
        <YAxis tickFormatter={compact} width={44} {...axis} />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(v: number, name: string, item) => {
            const row = item?.payload as AgingBucket | undefined;
            return name === "amount"
              ? [`PKR ${compact(v)}`, "Total amount"]
              : [`${v} payments (${row ? `PKR ${compact(row.amount)}` : ""})`, "Count"];
          }}
        />
        <Bar dataKey="count" radius={[6, 6, 0, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={tone[i] ?? COLORS.danger} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Horizontal histogram for days-on-market. */
export function InventoryAgingChart({ data }: { data: InventoryAgingBucket[] }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="space-y-2">
      {data.map((b, i) => {
        const width = Math.round((b.count / max) * 100);
        // Older buckets get warmer tone — visual cue that 180+ inventory is stale.
        const cls = i < 2 ? "brand-gradient" : i < 4 ? "bg-warn" : "bg-danger";
        return (
          <div key={b.label} className="grid grid-cols-[120px_1fr_auto] items-center gap-3 text-sm">
            <span className="text-slate">{b.label}</span>
            <div className="h-3 overflow-hidden rounded-full bg-line-soft">
              <div className={`h-full ${cls}`} style={{ width: `${width}%` }} />
            </div>
            <span className="w-12 text-right font-semibold tabular-nums text-ink">{b.count}</span>
          </div>
        );
      })}
    </div>
  );
}
