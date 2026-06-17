import "server-only";
import path from "node:path";
import { mkdir, rm } from "node:fs/promises";
import makeWASocket, {
  // Baileys helper (not a React hook) — aliased so the hooks linter doesn't
  // mistake the `use*` name for one.
  useMultiFileAuthState as loadFileAuthState,
  DisconnectReason,
  type WASocket,
} from "@whiskeysockets/baileys";
import { UPLOAD_ROOT } from "@/lib/uploads";
import { prisma } from "@/lib/prisma";

/**
 * Unofficial QR-linked WhatsApp (Baileys). Holds one live socket per company in
 * a process-global singleton (the single PM2 fork is long-lived), with auth
 * credentials persisted to a per-company directory on disk so a link survives
 * restarts. The DB WhatsAppSession row mirrors status for the UI.
 *
 * ⚠️ This automates a regular WhatsApp account and is against Meta's ToS — the
 * linked number can be banned. The official Cloud API path (Settings →
 * Integrations) remains the supported, ban-safe option.
 */

export type WaStatus = "PENDING" | "CONNECTED" | "DISCONNECTED";

interface Session {
  sock?: WASocket;
  qr: string | null;
  status: WaStatus;
  starting: boolean;
}

const g = globalThis as unknown as { __waQrSessions?: Map<string, Session> };
const sessions: Map<string, Session> = (g.__waQrSessions ??= new Map());

const SESSION_ROOT = process.env.WA_SESSION_ROOT ?? path.join(UPLOAD_ROOT, "..", "wa-sessions");
const dirFor = (companyId: string) => path.join(SESSION_ROOT, companyId.replace(/[^\w-]/g, ""));

async function setDbStatus(companyId: string, status: WaStatus, phone?: string) {
  try {
    await prisma.whatsAppSession.upsert({
      where: { companyId },
      create: { companyId, status, phone: phone ?? null, linkedAt: status === "CONNECTED" ? new Date() : null },
      update: { status, ...(phone ? { phone } : {}), ...(status === "CONNECTED" ? { linkedAt: new Date() } : {}) },
    });
  } catch {
    /* best-effort */
  }
}

/** Start (or reconnect) a company's WhatsApp socket. Idempotent: a no-op if one
 *  is already connected or mid-connect. Reconnects silently when creds exist. */
export async function startSession(companyId: string): Promise<void> {
  const existing = sessions.get(companyId);
  if (existing && (existing.status === "CONNECTED" || existing.starting)) return;

  const session: Session = existing ?? { qr: null, status: "DISCONNECTED", starting: false };
  session.starting = true;
  sessions.set(companyId, session);

  try {
    const dir = dirFor(companyId);
    await mkdir(dir, { recursive: true });
    const { state, saveCreds } = await loadFileAuthState(dir);

    const sock = makeWASocket({
      auth: state,
      browser: ["Proptimizr CRM", "Chrome", "1.0.0"],
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });
    session.sock = sock;
    session.starting = false;

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (u) => {
      const cur = sessions.get(companyId);
      if (!cur) return;
      if (u.qr) {
        cur.qr = u.qr;
        cur.status = "PENDING";
        void setDbStatus(companyId, "PENDING");
      }
      if (u.connection === "open") {
        cur.qr = null;
        cur.status = "CONNECTED";
        void setDbStatus(companyId, "CONNECTED", sock.user?.id ?? undefined);
      }
      if (u.connection === "close") {
        cur.sock = undefined;
        const code = (u.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) {
          cur.status = "DISCONNECTED";
          cur.qr = null;
          void rm(dirFor(companyId), { recursive: true, force: true }).catch(() => {});
          void setDbStatus(companyId, "DISCONNECTED");
        } else {
          cur.status = "DISCONNECTED";
          // Transient drop → reconnect shortly (creds persist, no new QR).
          setTimeout(() => void startSession(companyId).catch(() => {}), 2500);
        }
      }
    });

    // Inbound capture is a follow-up — listener registered so the socket drains.
    sock.ev.on("messages.upsert", () => {});
  } catch {
    session.starting = false;
    session.status = "DISCONNECTED";
  }
}

/** Current status + the latest QR string (to render), kicking off a lazy
 *  reconnect when creds exist on disk but no live socket is held (post-restart). */
export async function getStatus(companyId: string): Promise<{ status: WaStatus; qr: string | null }> {
  const s = sessions.get(companyId);
  if (!s || (!s.sock && !s.starting)) {
    // Reconnect if a previous link exists; otherwise stays DISCONNECTED.
    const row = await prisma.whatsAppSession.findUnique({ where: { companyId }, select: { status: true } });
    if (row && row.status !== "DISCONNECTED") void startSession(companyId).catch(() => {});
  }
  const cur = sessions.get(companyId);
  return { status: cur?.status ?? "DISCONNECTED", qr: cur?.qr ?? null };
}

export async function sendText(companyId: string, toPhone: string, text: string): Promise<boolean> {
  const s = sessions.get(companyId);
  if (!s?.sock || s.status !== "CONNECTED") return false;
  const jid = `${toPhone.replace(/\D/g, "")}@s.whatsapp.net`;
  await s.sock.sendMessage(jid, { text });
  return true;
}

export async function logout(companyId: string): Promise<void> {
  const s = sessions.get(companyId);
  try {
    await s?.sock?.logout();
  } catch {
    /* ignore */
  }
  await rm(dirFor(companyId), { recursive: true, force: true }).catch(() => {});
  sessions.delete(companyId);
  await setDbStatus(companyId, "DISCONNECTED");
}
