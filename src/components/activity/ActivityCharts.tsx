"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { COLORS } from "@/lib/theme";

const { accent: ACCENT, line: LINE, muted: MUTED, paper: PAPER } = COLORS;

const axis = { stroke: MUTED, fontSize: 11, tickLine: false, axisLine: { stroke: LINE } };
const tooltipStyle = {
  border: `1px solid ${LINE}`,
  borderRadius: 12,
  fontSize: 12,
  background: PAPER,
  boxShadow: "0 8px 24px -12px rgba(15, 23, 42, 0.16)",
} as const;

export function ActivityTrend({ data }: { data: { day: string; count: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="actTrend" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity={0.28} />
            <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={LINE} vertical={false} />
        <XAxis dataKey="day" {...axis} />
        <YAxis allowDecimals={false} width={28} {...axis} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [v, "Actions"]} />
        <Area type="monotone" dataKey="count" stroke={ACCENT} strokeWidth={2} fill="url(#actTrend)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function EntityBreakdown({ data }: { data: { entity: string; count: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={LINE} horizontal={false} />
        <XAxis type="number" allowDecimals={false} {...axis} />
        <YAxis type="category" dataKey="entity" width={96} {...axis} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(79, 70, 229, 0.06)" }} formatter={(v: number) => [v, "Actions"]} />
        <Bar dataKey="count" fill={ACCENT} radius={[0, 6, 6, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
