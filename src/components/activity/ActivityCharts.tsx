"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const ACCENT = "#2c5f8a";
const LINE = "#e6e3dd";
const MUTED = "#8a99ae";

const axis = { stroke: MUTED, fontSize: 11, tickLine: false, axisLine: { stroke: LINE } };
const tooltipStyle = { border: `1px solid ${LINE}`, borderRadius: 8, fontSize: 12 } as const;

export function ActivityTrend({ data }: { data: { day: string; count: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="actTrend" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity={0.25} />
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
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(0,0,0,0.03)" }} formatter={(v: number) => [v, "Actions"]} />
        <Bar dataKey="count" fill={ACCENT} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
