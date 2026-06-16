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

const { ink: INK, line: LINE, muted: MUTED, paper: PAPER } = COLORS;

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
            <stop offset="0%" stopColor="#6366f1" stopOpacity={0.34} />
            <stop offset="55%" stopColor="#4f46e5" stopOpacity={0.12} />
            <stop offset="100%" stopColor="#4f46e5" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="revStroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#6366f1" /><stop offset="100%" stopColor="#0ea5e9" />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={LINE} vertical={false} />
        <XAxis dataKey="month" {...axis} />
        <YAxis tickFormatter={compact} width={44} {...axis} />
        <Tooltip
          formatter={(v: number) => [`PKR ${compact(v)}`, "Revenue"]}
          contentStyle={tooltipStyle}
        />
        <Area type="monotone" dataKey="revenue" stroke="url(#revStroke)" strokeWidth={3} fill="url(#rev)" dot={false} activeDot={{ r: 5, stroke: "#4f46e5", strokeWidth: 2.5, fill: PAPER }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function LeadFunnel({ data }: { data: { stage: string; count: number }[] }) {
  const max = data.length - 1;
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="repFunnel" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#6366f1" /><stop offset="100%" stopColor="#0ea5e9" />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={LINE} horizontal={false} />
        <XAxis type="number" {...axis} allowDecimals={false} />
        <YAxis type="category" dataKey="stage" width={120} {...axis} />
        <Tooltip
          formatter={(v: number) => [v, "Leads"]}
          contentStyle={tooltipStyle}
          cursor={{ fill: "rgba(79, 70, 229, 0.06)" }}
        />
        <Bar dataKey="count" radius={[0, 7, 7, 0]} barSize={18}>
          {data.map((_, i) => (
            <Cell key={i} fill={i === max ? INK : "url(#repFunnel)"} fillOpacity={i === max ? 1 : 0.55 + (i / Math.max(max, 1)) * 0.45} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
