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
import { compactMoney, humanize, localizeDigits } from "@/lib/format";
import type { Locale } from "@/lib/i18n/dictionary";

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

interface RevenueTrendChartProps {
  data: RevenuePoint[];
  locale?: Locale;
  labels?: { peak?: string };
}

export function RevenueTrendChart({ data, locale = "en", labels }: RevenueTrendChartProps) {
  const total = data.reduce((s, p) => s + p.revenue, 0);
  const peak = Math.max(...data.map((p) => p.revenue));
  const peakMonth = data.find((p) => p.revenue === peak)?.month ?? "—";

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3 px-1">
        <div>
          <p className="text-[1.7rem] font-bold leading-none tracking-[-0.02em] text-ink">
            {compactMoney(total, locale)}
          </p>
          <p className="mt-1 text-xs text-muted">
            {localizeDigits(data.length, locale)}-month sales total
          </p>
        </div>
        {peak > 0 && (
          <div className="text-end">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
              {labels?.peak ?? "Peak"}
            </p>
            <p className="text-sm font-semibold text-accent">
              {peakMonth} · {compactMoney(peak, locale)}
            </p>
          </div>
        )}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="dashRev" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6366f1" stopOpacity={0.38} />
              <stop offset="55%" stopColor="#4f46e5" stopOpacity={0.14} />
              <stop offset="100%" stopColor="#4f46e5" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="dashRevStroke" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#6366f1" />
              <stop offset="100%" stopColor="#0ea5e9" />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.line} vertical={false} />
          <XAxis dataKey="month" {...axis} />
          <YAxis
            tickFormatter={(v: number) => {
              const s = v >= 1_000_000
                ? `${(v / 1_000_000).toFixed(1)}M`
                : v >= 1_000
                  ? `${Math.round(v / 1_000)}K`
                  : String(v);
              return localizeDigits(s, locale);
            }}
            width={44}
            {...axis}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            labelStyle={labelStyle}
            formatter={(v: number) => [compactMoney(v, locale), "Revenue"]}
          />
          <Area
            type="monotone"
            dataKey="revenue"
            stroke="url(#dashRevStroke)"
            strokeWidth={3}
            fill="url(#dashRev)"
            dot={false}
            activeDot={{ r: 6, stroke: "#4f46e5", strokeWidth: 2.5, fill: COLORS.paper }}
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

interface InventoryDonutProps {
  data: Record<string, number>;
  locale?: Locale;
  statusLabels?: Partial<Record<string, string>>;
  totalLabel?: string;
}

export function InventoryDonut({
  data,
  locale = "en",
  statusLabels,
  totalLabel = "Total",
}: InventoryDonutProps) {
  const entries = Object.entries(data);
  const total = entries.reduce((s, [, n]) => s + n, 0);

  if (total === 0) {
    return <p className="py-8 text-center text-sm text-muted">—</p>;
  }

  const slices = entries
    .map(([status, count], i) => ({
      name: statusLabels?.[status] ?? humanize(status),
      status,
      value: count,
      color: STATUS_COLOR[status] ?? INVENTORY_FALLBACK[i % INVENTORY_FALLBACK.length],
    }))
    .sort((a, b) => b.value - a.value);

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div
        className="relative h-44 w-44 shrink-0"
        style={{ filter: "drop-shadow(0 10px 16px rgba(15,23,42,0.12))" }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              innerRadius={56}
              outerRadius={86}
              paddingAngle={2.5}
              startAngle={90}
              endAngle={-270}
              stroke={COLORS.paper}
              strokeWidth={2.5}
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
                return [
                  `${localizeDigits(v, locale)} · ${localizeDigits(pct, locale)}%`,
                  label,
                ];
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
              {totalLabel}
            </p>
            <p className="text-[1.75rem] font-bold leading-none tracking-[-0.02em] text-ink">
              {localizeDigits(total, locale)}
            </p>
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
              <span className="font-bold text-ink">
                {localizeDigits(s.value, locale)}
              </span>
              <span className="w-10 text-end text-xs text-muted">
                {localizeDigits(pct, locale)}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ──────────────────────────────────────────── Leads funnel ──────── */

interface LeadsFunnelChartProps {
  data: { stage: string; count: number }[];
  locale?: Locale;
  stageLabels?: Partial<Record<string, string>>;
}

export function LeadsFunnelChart({
  data,
  locale = "en",
  stageLabels,
}: LeadsFunnelChartProps) {
  const max = Math.max(...data.map((d) => d.count), 1);
  const rows = data.map((d) => ({
    stage: stageLabels?.[d.stage] ?? humanize(d.stage),
    count: d.count,
    raw: d.stage,
  }));

  return (
    <ResponsiveContainer width="100%" height={Math.max(240, rows.length * 28)}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="funnelAccent" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#6366f1" /><stop offset="100%" stopColor="#0ea5e9" />
          </linearGradient>
          <linearGradient id="funnelOk" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#16a34a" /><stop offset="100%" stopColor="#34d399" />
          </linearGradient>
          <linearGradient id="funnelWarn" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#d97706" /><stop offset="100%" stopColor="#f59e0b" />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={COLORS.line} horizontal={false} />
        <XAxis
          type="number"
          {...axis}
          allowDecimals={false}
          tickFormatter={(v: number) => localizeDigits(v, locale)}
        />
        <YAxis type="category" dataKey="stage" width={120} {...axis} />
        <Tooltip
          contentStyle={tooltipStyle}
          labelStyle={labelStyle}
          formatter={(v: number) => [localizeDigits(v, locale), "Leads"]}
          cursor={{ fill: "rgba(79, 70, 229, 0.06)" }}
        />
        <Bar dataKey="count" radius={[0, 7, 7, 0]} barSize={18}>
          {rows.map((r, i) => {
            const grad =
              r.raw === "CLOSED_WON"
                ? "url(#funnelOk)"
                : r.raw === "NEGOTIATION" || r.raw === "PAYMENT"
                  ? "url(#funnelWarn)"
                  : "url(#funnelAccent)";
            return <Cell key={i} fill={grad} fillOpacity={0.55 + (r.count / max) * 0.45} />;
          })}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
