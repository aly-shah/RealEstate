"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { createEvent, setEventStatus, type FormState } from "./actions";
import { humanize } from "@/lib/format";
import { Icon } from "@/components/ui/Icon";

const TYPES = [
  "SHOWING",
  "MEETING",
  "FOLLOW_UP",
  "OPEN_HOUSE",
  "PAYMENT_REMINDER",
  "DOCUMENT_REMINDER",
  "RENTAL_RENEWAL",
  "DEAL_CLOSING",
] as const;

/** Each event type gets a distinct colour so the grid reads at a glance. */
const TYPE_COLOR: Record<string, string> = {
  SHOWING: "#4f46e5", // indigo
  MEETING: "#0ea5e9", // sky
  FOLLOW_UP: "#f59e0b", // amber
  OPEN_HOUSE: "#10b981", // emerald
  PAYMENT_REMINDER: "#b88a2a", // gold
  DOCUMENT_REMINDER: "#8b5cf6", // violet
  RENTAL_RENEWAL: "#06b6d4", // cyan
  DEAL_CLOSING: "#e11d48", // rose
};
const colorFor = (t: string) => TYPE_COLOR[t] ?? "#64748b";

export interface CalEvent {
  id: string;
  title: string;
  type: string;
  status: string;
  startAt: string;
  agentName: string | null;
  propertyTitle: string | null;
}

interface CalendarClientProps {
  events: CalEvent[];
  agents: { id: string; name: string }[];
  properties: { id: string; title: string; reference: string }[];
  canAssign: boolean;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Local-time YYYY-MM-DD key — events group by the day the user sees them. */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** 42-cell (6×7) grid for the given month, weeks starting Monday. */
function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // Mon=0 … Sun=6
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    days.push(new Date(year, month, 1 - offset + i));
  }
  return days;
}

function relativeDayLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const day = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return day.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

export function CalendarClient({ events, agents, properties, canAssign }: CalendarClientProps) {
  const today = new Date();
  const todayKey = dayKey(today);

  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [view, setView] = useState<"month" | "agenda">("month");
  const [selectedKey, setSelectedKey] = useState<string>(todayKey);
  const [formOpen, setFormOpen] = useState(false);

  const [state, action, pending] = useActionState<FormState, FormData>(async (p, fd) => {
    const res = await createEvent(p, fd);
    if (!res.error) setFormOpen(false);
    return res;
  }, {});

  // Close the create modal on Escape for a native-app feel.
  useEffect(() => {
    if (!formOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFormOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [formOpen]);

  const byDay = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    for (const e of events) {
      const k = dayKey(new Date(e.startAt));
      const list = map.get(k);
      if (list) list.push(e);
      else map.set(k, [e]);
    }
    for (const list of map.values()) list.sort((a, b) => a.startAt.localeCompare(b.startAt));
    return map;
  }, [events]);

  const grid = useMemo(() => monthGrid(cursor.y, cursor.m), [cursor]);

  const selectedEvents = byDay.get(selectedKey) ?? [];

  function shiftMonth(delta: number) {
    setCursor((c) => {
      const d = new Date(c.y, c.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  }
  function goToday() {
    setCursor({ y: today.getFullYear(), m: today.getMonth() });
    setSelectedKey(todayKey);
  }
  function openCreate(dayK?: string) {
    if (dayK) setSelectedKey(dayK);
    setFormOpen(true);
  }

  // Agenda groups: every day that has events, in chronological order.
  const agendaGroups = useMemo(() => {
    return Array.from(byDay.keys())
      .sort()
      .map((k) => ({ key: k, label: relativeDayLabel(k), events: byDay.get(k)! }));
  }, [byDay]);

  return (
    <div>
      {/* Toolbar */}
      <div className="surface mb-4 flex flex-wrap items-center gap-3 p-3">
        <div className="flex items-center gap-1">
          <button onClick={goToday} className="btn-ghost px-3 py-1.5 text-sm">Today</button>
          <button onClick={() => shiftMonth(-1)} aria-label="Previous month" className="btn-ghost h-9 w-9 p-0">
            <Icon name="chevron-left" className="h-4 w-4" />
          </button>
          <button onClick={() => shiftMonth(1)} aria-label="Next month" className="btn-ghost h-9 w-9 p-0">
            <Icon name="chevron-right" className="h-4 w-4" />
          </button>
        </div>
        <h2 className="text-lg font-semibold text-ink">
          {MONTHS[cursor.m]} <span className="text-muted">{cursor.y}</span>
        </h2>

        <div className="ms-auto flex items-center gap-2">
          <div className="inline-flex rounded-xl border border-line bg-white p-0.5">
            {(["month", "agenda"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition ${
                  view === v ? "bg-accent text-white shadow-sm" : "text-slate hover:text-accent"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
          <button onClick={() => openCreate()} className="btn-accent">
            <Icon name="plus" className="h-4 w-4" /> New event
          </button>
        </div>
      </div>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-5">
        {/* Main view */}
        <div className="min-w-0">
          {view === "month" ? (
            <div className="surface overflow-hidden">
              <div className="grid grid-cols-7 border-b border-line bg-canvas/60 text-center text-[11px] font-semibold uppercase tracking-wide text-muted">
                {WEEKDAYS.map((w) => (
                  <div key={w} className="py-2">{w}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-px bg-line">
                {grid.map((d) => {
                  const k = dayKey(d);
                  const inMonth = d.getMonth() === cursor.m;
                  const isToday = k === todayKey;
                  const isSelected = k === selectedKey;
                  const dayEvents = byDay.get(k) ?? [];
                  return (
                    <button
                      key={k}
                      onClick={() => setSelectedKey(k)}
                      onDoubleClick={() => openCreate(k)}
                      className={`flex min-h-[84px] flex-col gap-1 p-1.5 text-start align-top transition sm:min-h-[104px] ${
                        isSelected ? "bg-accent-wash/70" : inMonth ? "bg-paper hover:bg-accent-wash/30" : "bg-canvas/50 hover:bg-canvas"
                      }`}
                    >
                      <span
                        className={`inline-flex h-6 min-w-6 items-center justify-center self-start rounded-full px-1 text-xs font-semibold ${
                          isToday ? "bg-accent text-white" : inMonth ? "text-ink" : "text-muted"
                        }`}
                      >
                        {d.getDate()}
                      </span>
                      <span className="flex flex-col gap-1">
                        {dayEvents.slice(0, 3).map((e) => {
                          const c = colorFor(e.type);
                          const done = e.status === "DONE";
                          return (
                            <span
                              key={e.id}
                              title={`${fmtTime(e.startAt)} · ${e.title}`}
                              className={`flex items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-[11px] font-medium ${done ? "line-through opacity-50" : ""}`}
                              style={{ backgroundColor: `${c}1f`, color: c }}
                            >
                              <span className="hidden shrink-0 tabular-nums opacity-70 sm:inline">{fmtTime(e.startAt)}</span>
                              <span className="truncate">{e.title}</span>
                            </span>
                          );
                        })}
                        {dayEvents.length > 3 && (
                          <span className="ps-1 text-[10px] font-medium text-muted">+{dayEvents.length - 3} more</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {agendaGroups.length === 0 ? (
                <p className="surface p-8 text-center text-sm text-muted">No events scheduled.</p>
              ) : (
                agendaGroups.map((g) => (
                  <div key={g.key}>
                    <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-accent">{g.label}</h3>
                    <ul className="space-y-2">
                      {g.events.map((e) => (
                        <EventRow key={e.id} event={e} />
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Selected-day rail */}
        <aside className="mt-5 space-y-4 lg:mt-0">
          <div className="surface p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-accent">{relativeDayLabel(selectedKey)}</p>
                <p className="text-sm text-muted">
                  {selectedEvents.length} {selectedEvents.length === 1 ? "event" : "events"}
                </p>
              </div>
              <button onClick={() => openCreate(selectedKey)} aria-label="Add event" className="btn-ghost h-9 w-9 p-0">
                <Icon name="plus" className="h-4 w-4" />
              </button>
            </div>
            {selectedEvents.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line py-6 text-center text-sm text-muted">
                Nothing scheduled.
              </p>
            ) : (
              <ul className="space-y-2">
                {selectedEvents.map((e) => (
                  <EventRow key={e.id} event={e} compact />
                ))}
              </ul>
            )}
          </div>

          <div className="surface p-4">
            <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-muted">Event types</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              {TYPES.map((t) => (
                <span key={t} className="flex items-center gap-2 text-xs text-slate">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: colorFor(t) }} />
                  <span className="truncate">{humanize(t)}</span>
                </span>
              ))}
            </div>
          </div>
        </aside>
      </div>

      {/* Create modal */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
          <div className="absolute inset-0 bg-ink/30 backdrop-blur-sm" onClick={() => setFormOpen(false)} aria-hidden />
          <div className="surface-soft relative z-10 w-full max-w-lg rounded-b-none rounded-t-2xl p-6 sm:rounded-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-semibold text-ink">New event</h3>
              <button onClick={() => setFormOpen(false)} aria-label="Close" className="btn-ghost h-8 w-8 p-0">✕</button>
            </div>
            <form action={action} className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="label" htmlFor="title">Title</label>
                <input id="title" name="title" className="field" placeholder="e.g. Site visit with the Khan family" required />
                {state.fieldErrors?.title && <p className="mt-1 text-xs text-danger">{state.fieldErrors.title[0]}</p>}
              </div>
              <div>
                <label className="label" htmlFor="type">Type</label>
                <select id="type" name="type" className="field" defaultValue="SHOWING">
                  {TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="startAt">Start</label>
                <input id="startAt" name="startAt" type="datetime-local" className="field" defaultValue={`${selectedKey}T09:00`} required />
              </div>
              {canAssign && (
                <div>
                  <label className="label" htmlFor="agentId">Assign to</label>
                  <select id="agentId" name="agentId" className="field" defaultValue="">
                    <option value="">— Me —</option>
                    {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="label" htmlFor="propertyId">Property (optional)</label>
                <select id="propertyId" name="propertyId" className="field" defaultValue="">
                  <option value="">— None —</option>
                  {properties.map((p) => <option key={p.id} value={p.id}>{p.reference} · {p.title}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="label" htmlFor="notes">Notes (optional)</label>
                <textarea id="notes" name="notes" rows={2} className="field" placeholder="Anything the team should know…" />
              </div>
              {state.error && <p className="text-xs text-danger sm:col-span-2">{state.error}</p>}
              <div className="flex gap-2 sm:col-span-2">
                <button type="submit" disabled={pending} className="btn-primary">{pending ? "Saving…" : "Add to calendar"}</button>
                <button type="button" onClick={() => setFormOpen(false)} className="btn-ghost">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function EventRow({ event, compact }: { event: CalEvent; compact?: boolean }) {
  const c = colorFor(event.type);
  const done = event.status === "DONE";
  return (
    <li
      className="flex items-center gap-3 rounded-xl border border-line bg-paper px-3 py-2.5"
      style={{ borderInlineStartColor: c, borderInlineStartWidth: 3 }}
    >
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm font-semibold text-ink ${done ? "line-through opacity-60" : ""}`}>{event.title}</p>
        <p className="truncate text-xs text-muted">
          <span className="tabular-nums">{fmtTime(event.startAt)}</span>
          <span className="mx-1" style={{ color: c }}>· {humanize(event.type)}</span>
          {event.agentName ? ` · ${event.agentName}` : ""}
          {!compact && event.propertyTitle ? ` · ${event.propertyTitle}` : ""}
        </p>
      </div>
      {done ? (
        <span className="chip border-ok/25 bg-ok-bg text-ok">
          <Icon name="check" className="h-3 w-3" /> Done
        </span>
      ) : (
        <form action={setEventStatus}>
          <input type="hidden" name="id" value={event.id} />
          <input type="hidden" name="status" value="DONE" />
          <button type="submit" className="btn-ghost shrink-0 px-2 py-1 text-xs">
            <Icon name="check" className="h-3.5 w-3.5" /> Done
          </button>
        </form>
      )}
    </li>
  );
}
