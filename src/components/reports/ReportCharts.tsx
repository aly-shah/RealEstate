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

const { ink: INK, accent: ACCENT, line: LINE, muted: MUTED, paper: PAPER } = COLORS;

const axis = { stroke: MUTED, fontSize: 11, tickLine: false, axisLine: { stroke: LINE } };
const tooltipStyle = {
  border: `1px solid ${LINE}`,
  borderRadius: 12,
  fontSize: 12,
  background: PAPER,
  boxShadow: "0 8px 24px -12px rgba(15, 23, 42, 0.16)",
};

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

export function RevenueTrend({ data }: { data: { month: string; revenue: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity={0.28} />
            <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={LINE} vertical={false} />
        <XAxis dataKey="month" {...axis} />
        <YAxis tickFormatter={compact} width={44} {...axis} />
        <Tooltip
          formatter={(v: number) => [`PKR ${compact(v)}`, "Revenue"]}
          contentStyle={tooltipStyle}
        />
        <Area type="monotone" dataKey="revenue" stroke={ACCENT} strokeWidth={2} fill="url(#rev)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function LeadFunnel({ data }: { data: { stage: string; count: number }[] }) {
  const max = data.length - 1;
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={LINE} horizontal={false} />
        <XAxis type="number" {...axis} allowDecimals={false} />
        <YAxis type="category" dataKey="stage" width={120} {...axis} />
        <Tooltip
          formatter={(v: number) => [v, "Leads"]}
          contentStyle={tooltipStyle}
          cursor={{ fill: "rgba(79, 70, 229, 0.06)" }}
        />
        <Bar dataKey="count" radius={[0, 6, 6, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={i === max ? INK : ACCENT} fillOpacity={0.35 + (i / Math.max(max, 1)) * 0.5} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
