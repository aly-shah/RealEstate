"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { COLORS, STATUS_COLOR } from "@/lib/theme";
import { compactMoney, humanize } from "@/lib/format";

const axis = {
  stroke: COLORS.muted,
  fontSize: 11,
  tickLine: false,
  axisLine: { stroke: COLORS.line },
};

const tooltipStyle = {
  border: `1px solid ${COLORS.line}`,
  borderRadius: 12,
  fontSize: 12,
  background: COLORS.paper,
  boxShadow: "0 10px 28px -12px rgba(15, 23, 42, 0.18)",
  padding: "8px 12px",
} as const;

const labelStyle = { color: COLORS.muted, fontSize: 11, fontWeight: 500 } as const;

/* ──────────────────────────────────────────── Revenue trend ───────── */

interface RevenuePoint {
  month: string;
  revenue: number;
}

export function RevenueTrendChart({ data }: { data: RevenuePoint[] }) {
  const total = data.reduce((s, p) => s + p.revenue, 0);
  const peak = Math.max(...data.map((p) => p.revenue));
  const peakMonth = data.find((p) => p.revenue === peak)?.month ?? "—";

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3 px-1">
        <div>
          <p className="text-2xl font-semibold tracking-tight text-ink">
            {compactMoney(total)}
          </p>
          <p className="text-xs text-muted">{data.length}-month sales total</p>
        </div>
        {peak > 0 && (
          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Peak</p>
            <p className="text-sm font-semibold text-accent">
              {peakMonth} · {compactMoney(peak)}
            </p>
          </div>
        )}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="dashRev" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLORS.accent} stopOpacity={0.32} />
              <stop offset="100%" stopColor={COLORS.accent} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.line} vertical={false} />
          <XAxis dataKey="month" {...axis} />
          <YAxis
            tickFormatter={(v: number) =>
              v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `${Math.round(v / 1_000)}K` : String(v)
            }
            width={44}
            {...axis}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            labelStyle={labelStyle}
            formatter={(v: number) => [compactMoney(v), "Revenue"]}
          />
          <Area
            type="monotone"
            dataKey="revenue"
            stroke={COLORS.accent}
            strokeWidth={2.5}
            fill="url(#dashRev)"
            dot={{ r: 3, stroke: COLORS.accent, strokeWidth: 2, fill: COLORS.paper }}
            activeDot={{ r: 5, stroke: COLORS.accent, strokeWidth: 2, fill: COLORS.paper }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ──────────────────────────────────────────── Inventory donut ───── */

const INVENTORY_FALLBACK = [
  COLORS.accent,
  COLORS.ok,
  COLORS.warn,
  COLORS.accentSoft,
  COLORS.gold,
  COLORS.muted,
  COLORS.danger,
];

export function InventoryDonut({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data);
  const total = entries.reduce((s, [, n]) => s + n, 0);

  if (total === 0) {
    return <p className="py-8 text-center text-sm text-muted">No properties yet.</p>;
  }

  const slices = entries
    .map(([status, count], i) => ({
      name: humanize(status),
      status,
      value: count,
      color: STATUS_COLOR[status] ?? INVENTORY_FALLBACK[i % INVENTORY_FALLBACK.length],
    }))
    .sort((a, b) => b.value - a.value);

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="relative h-44 w-44 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              innerRadius={56}
              outerRadius={84}
              paddingAngle={2}
              startAngle={90}
              endAngle={-270}
              stroke={COLORS.paper}
              strokeWidth={2}
            >
              {slices.map((s) => (
                <Cell key={s.status} fill={s.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={labelStyle}
              formatter={(v: number, _name, item) => {
                const pct = total ? Math.round((v / total) * 100) : 0;
                const label = (item && (item as { name?: string }).name) || "";
                return [`${v} · ${pct}%`, label];
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">Total</p>
            <p className="text-2xl font-semibold tracking-tight text-ink">{total}</p>
          </div>
        </div>
      </div>

      <ul className="grid w-full grid-cols-1 gap-1.5 text-sm sm:max-w-[14rem]">
        {slices.map((s) => {
          const pct = total ? Math.round((s.value / total) * 100) : 0;
          return (
            <li key={s.status} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
              <span className="min-w-0 flex-1 truncate text-slate">{s.name}</span>
              <span className="font-semibold text-ink">{s.value}</span>
              <span className="w-9 text-right text-xs text-muted">{pct}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ──────────────────────────────────────────── Leads funnel ──────── */

export function LeadsFunnelChart({ data }: { data: { stage: string; count: number }[] }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  const rows = data.map((d) => ({ stage: humanize(d.stage), count: d.count, raw: d.stage }));

  return (
    <ResponsiveContainer width="100%" height={Math.max(240, rows.length * 28)}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={COLORS.line} horizontal={false} />
        <XAxis type="number" {...axis} allowDecimals={false} />
        <YAxis type="category" dataKey="stage" width={120} {...axis} />
        <Tooltip
          contentStyle={tooltipStyle}
          labelStyle={labelStyle}
          formatter={(v: number) => [v, "Leads"]}
          cursor={{ fill: "rgba(79, 70, 229, 0.06)" }}
        />
        <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={16}>
          {rows.map((r, i) => {
            const intensity = 0.45 + (r.count / max) * 0.55;
            const fill =
              r.raw === "CLOSED_WON" ? COLORS.ok : r.raw === "NEGOTIATION" || r.raw === "PAYMENT" ? COLORS.warn : COLORS.accent;
            return <Cell key={i} fill={fill} fillOpacity={intensity} />;
          })}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
