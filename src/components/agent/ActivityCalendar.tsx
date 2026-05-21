"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

export interface ActivityItem {
  /** Local calendar day key, YYYY-MM-DD */
  day: string;
  /** ISO datetime for ordering / time display */
  at: string;
  kind: "EVENT" | "VISIT";
  type: string; // event type or visit verification
  title: string;
  href?: string;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function dayKey(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function ActivityCalendar({ items }: { items: ActivityItem[] }) {
  const today = new Date();
  const todayKey = dayKey(today.getFullYear(), today.getMonth(), today.getDate());

  const [view, setView] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [selected, setSelected] = useState<string>(todayKey);

  // Group activity by day for quick lookup.
  const byDay = useMemo(() => {
    const map = new Map<string, ActivityItem[]>();
    for (const it of items) map.set(it.day, [...(map.get(it.day) ?? []), it]);
    for (const list of map.values()) list.sort((a, b) => a.at.localeCompare(b.at));
    return map;
  }, [items]);

  // Build the month grid (Monday-first).
  const cells = useMemo(() => {
    const first = new Date(view.y, view.m, 1);
    const offset = (first.getDay() + 6) % 7; // Mon=0
    const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
    const out: (number | null)[] = Array(offset).fill(null);
    for (let d = 1; d <= daysInMonth; d++) out.push(d);
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [view]);

  const move = (delta: number) => {
    const d = new Date(view.y, view.m + delta, 1);
    setView({ y: d.getFullYear(), m: d.getMonth() });
  };

  const selectedItems = byDay.get(selected) ?? [];
  const monthCount = items.filter((i) => i.day.startsWith(`${view.y}-${String(view.m + 1).padStart(2, "0")}`)).length;

  return (
    <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      {/* Calendar grid */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-ink">{MONTHS[view.m]} {view.y}</h3>
            <span className="text-xs text-muted">· {monthCount} activities</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => move(-1)} className="rounded-md border border-line px-2 py-1 text-xs hover:bg-line-soft" aria-label="Previous month">‹</button>
            <button onClick={() => { setView({ y: today.getFullYear(), m: today.getMonth() }); setSelected(todayKey); }} className="rounded-md border border-line px-2 py-1 text-xs hover:bg-line-soft">Today</button>
            <button onClick={() => move(1)} className="rounded-md border border-line px-2 py-1 text-xs hover:bg-line-soft" aria-label="Next month">›</button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center">
          {WEEKDAYS.map((w) => (
            <div key={w} className="pb-1 text-[11px] font-medium uppercase tracking-wide text-muted">{w}</div>
          ))}
          {cells.map((d, i) => {
            if (d === null) return <div key={i} />;
            const key = dayKey(view.y, view.m, d);
            const dayItems = byDay.get(key) ?? [];
            const isToday = key === todayKey;
            const isSel = key === selected;
            return (
              <button
                key={i}
                onClick={() => setSelected(key)}
                className={`relative flex aspect-square flex-col items-center justify-center rounded-md border text-sm transition ${
                  isSel
                    ? "border-ink bg-ink text-white"
                    : isToday
                      ? "border-ink/40 bg-white text-ink"
                      : "border-line bg-white text-slate hover:bg-line-soft"
                }`}
              >
                <span className={isToday && !isSel ? "font-semibold" : ""}>{d}</span>
                {dayItems.length > 0 && (
                  <span className="mt-0.5 flex gap-0.5">
                    {dayItems.slice(0, 3).map((_, k) => (
                      <span key={k} className={`h-1 w-1 rounded-full ${isSel ? "bg-white" : "bg-accent"}`} />
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected day agenda */}
      <div className="rounded-lg border border-line bg-line-soft/50 p-4">
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">
          {new Date(selected).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
        </p>
        {selectedItems.length === 0 ? (
          <p className="text-sm text-muted">No activity on this day.</p>
        ) : (
          <ul className="space-y-2">
            {selectedItems.map((it, i) => {
              const body = (
                <div className="flex items-start gap-2.5 rounded-md border border-line bg-white px-3 py-2">
                  <span className={`mt-0.5 inline-flex h-5 items-center rounded px-1.5 text-[10px] font-medium uppercase ${it.kind === "VISIT" ? "bg-accent-wash text-accent-soft" : "bg-line-soft text-slate"}`}>
                    {it.kind === "VISIT" ? "Visit" : "Task"}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{it.title}</p>
                    <p className="text-xs text-muted">{fmtTime(it.at)}</p>
                  </div>
                </div>
              );
              return (
                <li key={i}>{it.href ? <Link href={it.href}>{body}</Link> : body}</li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
