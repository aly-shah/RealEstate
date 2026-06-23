import { Client } from "pg";
import { prisma } from "@/lib/prisma";

/**
 * Real-time notification fan-out via Postgres LISTEN/NOTIFY.
 *
 * `publish()` emits a NOTIFY on a single channel (through Prisma — just a normal
 * query). One dedicated `pg` Client per process holds the LISTEN connection and
 * dispatches incoming events to the in-process SSE subscribers, keyed by userId.
 * Decoupled this way, a notification created by any path (web request, the cron
 * job tick, even a direct DB insert that calls pg_notify) reaches the user's open
 * tabs. Best-effort: if the listener can't connect, the app still works — clients
 * just fall back to the on-load unread count.
 */

const CHANNEL = "pz_notify";

export interface NotifyEvent {
  userId: string;
  companyId?: string;
  id?: string;
  type?: string;
  title?: string;
  link?: string | null;
}

type Sub = (e: NotifyEvent) => void;
const subs = new Map<string, Set<Sub>>();

let client: Client | null = null;
let connecting = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

/** pg rejects Prisma's `?schema=…` query param, so strip it from the URL. */
function connectionString(): string | null {
  const url = process.env.DATABASE_URL;
  return url ? url.split("?")[0] : null;
}

function teardown() {
  if (!client) return;
  try {
    client.removeAllListeners();
    client.end().catch(() => {});
  } catch {
    /* ignore */
  }
  client = null;
}

function scheduleReconnect() {
  if (reconnectTimer || subs.size === 0) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void ensureListener();
  }, 3000);
}

async function ensureListener(): Promise<void> {
  if (client || connecting) return;
  const cs = connectionString();
  if (!cs) return;
  connecting = true;
  try {
    const c = new Client({ connectionString: cs, application_name: "proptimizr-sse" });
    c.on("notification", (msg) => {
      if (!msg.payload) return;
      let e: NotifyEvent | null = null;
      try {
        e = JSON.parse(msg.payload) as NotifyEvent;
      } catch {
        return;
      }
      if (!e?.userId) return;
      const set = subs.get(e.userId);
      if (!set) return;
      for (const cb of set) {
        try {
          cb(e);
        } catch {
          /* a bad subscriber must not break the others */
        }
      }
    });
    c.on("error", () => {
      teardown();
      scheduleReconnect();
    });
    c.on("end", () => {
      teardown();
      scheduleReconnect();
    });
    await c.connect();
    await c.query(`LISTEN ${CHANNEL}`);
    client = c;
  } catch {
    scheduleReconnect();
  } finally {
    connecting = false;
  }
}

/** Subscribe a userId to live notification events. Returns an unsubscribe fn. */
export function subscribeUser(userId: string, cb: Sub): () => void {
  let set = subs.get(userId);
  if (!set) {
    set = new Set();
    subs.set(userId, set);
  }
  set.add(cb);
  void ensureListener();
  return () => {
    const s = subs.get(userId);
    if (!s) return;
    s.delete(cb);
    if (s.size === 0) subs.delete(userId);
  };
}

/** Fire-and-forget NOTIFY so the user's open tabs update in real time. */
export async function publish(e: NotifyEvent): Promise<void> {
  try {
    await prisma.$executeRaw`SELECT pg_notify(${CHANNEL}, ${JSON.stringify(e)})`;
  } catch {
    /* live push is best-effort; the notification row is already persisted */
  }
}
