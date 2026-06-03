import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { enqueueJob, JOB_TYPES } from "@/lib/jobs";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * WhatsApp Cloud API webhook receiver.
 *
 *   GET  — verification handshake. Meta calls with ?hub.mode=subscribe &
 *          hub.verify_token=… & hub.challenge=…; we echo the challenge if
 *          the supplied verify_token matches WHATSAPP_VERIFY_TOKEN.
 *   POST — message events. We validate X-Hub-Signature-256 against the raw
 *          body using WHATSAPP_APP_SECRET, then enqueue a job per inbound
 *          message so the response stays fast (Meta retries on timeouts).
 *
 * The actual lead-creation / matching logic lives in the
 * `lib/jobs/handlers/whatsapp-inbound.ts` handler — see that file's
 * comments for the Phase-9 hookup plan.
 */

export async function GET(req: NextRequest) {
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!expected) {
    return NextResponse.json({ error: "WHATSAPP_VERIFY_TOKEN not configured" }, { status: 503 });
  }
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token === expected && challenge) {
    return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return NextResponse.json({ error: "Verification failed" }, { status: 403 });
}

export async function POST(req: NextRequest) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    return NextResponse.json({ error: "WHATSAPP_APP_SECRET not configured" }, { status: 503 });
  }

  // We need the raw body to validate the HMAC signature — parsing JSON first
  // and re-stringifying would break because Meta hashes the on-wire bytes.
  const rawBody = await req.text();
  const headerSig = req.headers.get("x-hub-signature-256") ?? "";
  if (!validateSignature(rawBody, headerSig, appSecret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  // The Cloud API payload nests two siblings under `value`:
  //   { entry: [{ changes: [{ value: {
  //       metadata: { phone_number_id }, messages: [...], statuses: [...]
  //   } }] }] }
  // `messages` is inbound; `statuses` is delivery callbacks for outbound
  // sends. We extract both with their phone_number_id denormalised onto
  // each row, then enqueue one job per — keeps payloads tiny and the
  // handlers trivial.
  const { messages, statuses } = extractEvents(body);

  // Resolve phone_number_id → companyId for every distinct id across
  // both event types. Single round-trip via `in:` lookup — most webhooks
  // carry 1-2 events so the IN-list stays tiny. Misses (unknown phone
  // id) get null companyId and land at platform level for ops to triage.
  const distinctPhoneIds = [
    ...new Set(
      [...messages, ...statuses]
        .map((e) => e.phoneNumberId)
        .filter((v): v is string => !!v),
    ),
  ];
  const tenantMap = new Map<string, string>();
  if (distinctPhoneIds.length > 0) {
    const rows = await prisma.company.findMany({
      where: { whatsappPhoneId: { in: distinctPhoneIds } },
      select: { id: true, whatsappPhoneId: true },
    });
    for (const r of rows) {
      if (r.whatsappPhoneId) tenantMap.set(r.whatsappPhoneId, r.id);
    }
  }

  const ids: string[] = [];

  for (const m of messages) {
    const companyId = m.phoneNumberId ? tenantMap.get(m.phoneNumberId) ?? null : null;
    const id = await enqueueJob({
      type: JOB_TYPES.WHATSAPP_INBOUND,
      // Routed to the owning tenant when we recognise the phone_number_id;
      // platform-level (null) when the line isn't claimed yet — the
      // /admin/jobs view surfaces these so ops can prompt the tenant to
      // paste their phone_number_id into Settings.
      companyId,
      payload: m,
      // Meta retries on timeout — use the WhatsApp message id (`wamid...`)
      // as the dedup key so a retried delivery returns the existing job id
      // rather than enqueuing a second processing run.
      idempotencyKey: m.id ?? null,
    });
    ids.push(id);
  }

  for (const s of statuses) {
    const companyId = s.phoneNumberId ? tenantMap.get(s.phoneNumberId) ?? null : null;
    // Idempotency key combines wamid + status so a retried webhook
    // doesn't dupe rows, but a legitimate sent→delivered→read sequence
    // still creates one job per transition.
    const idKey = s.wamid && s.status ? `${s.wamid}:${s.status}` : null;
    const id = await enqueueJob({
      type: JOB_TYPES.WHATSAPP_STATUS,
      companyId,
      payload: s,
      idempotencyKey: idKey,
    });
    ids.push(id);
  }

  // Always 200 OK — Meta retries on non-2xx, and we've persisted the work.
  return NextResponse.json({ ok: true, enqueued: ids.length });
}

/**
 * Constant-time HMAC-SHA256 validation. Header format: `sha256=<hex>`.
 * Returns false on any malformed input rather than throwing — keeps the
 * route fail-closed.
 */
function validateSignature(rawBody: string, header: string, secret: string): boolean {
  if (!header.startsWith("sha256=")) return false;
  const supplied = header.slice("sha256=".length);
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  if (supplied.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

interface WaMessage {
  /** Meta's message id (`wamid....`) — stable, used as the idempotency key. */
  id?: string;
  from?: string;
  text?: string;
  timestamp?: string;
  /**
   * Meta's `phone_number_id` for the destination business line. Carried
   * per-message (denormalised from `value.metadata`) so the queue handler
   * doesn't need to re-walk the envelope to figure out tenant routing.
   */
  phoneNumberId?: string;
  raw?: unknown;
}

interface WaStatus {
  /** wamid of the OUTBOUND message this status relates to. */
  wamid?: string;
  /** "sent" | "delivered" | "read" | "failed" — kept as string to tolerate new values. */
  status?: string;
  timestamp?: string;
  recipientId?: string;
  /** Top error message when status === "failed". */
  error?: string;
  /** Same denormalised phone_number_id as messages. */
  phoneNumberId?: string;
  raw?: unknown;
}

/**
 * Defensive parser — extracts both `messages` (inbound) and `statuses`
 * (delivery callbacks for outbound) from one Meta envelope. Each row
 * carries the same denormalised `phone_number_id` for tenant routing.
 * Unknown fields on either type are preserved in `.raw` so a future
 * handler can opt-in without a webhook-side change.
 */
function extractEvents(body: unknown): { messages: WaMessage[]; statuses: WaStatus[] } {
  const messages: WaMessage[] = [];
  const statuses: WaStatus[] = [];
  const root = body as {
    entry?: Array<{
      changes?: Array<{
        value?: {
          metadata?: { phone_number_id?: string };
          messages?: unknown[];
          statuses?: unknown[];
        };
      }>;
    }>;
  };
  for (const entry of root.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const phoneNumberId =
        typeof change.value?.metadata?.phone_number_id === "string"
          ? change.value.metadata.phone_number_id
          : undefined;
      for (const msg of change.value?.messages ?? []) {
        const m = msg as { id?: string; from?: string; text?: { body?: string }; timestamp?: string };
        messages.push({
          id: typeof m.id === "string" ? m.id : undefined,
          from: typeof m.from === "string" ? m.from : undefined,
          text: typeof m.text?.body === "string" ? m.text.body : undefined,
          timestamp: typeof m.timestamp === "string" ? m.timestamp : undefined,
          phoneNumberId,
          raw: msg,
        });
      }
      for (const st of change.value?.statuses ?? []) {
        const s = st as {
          id?: string;
          status?: string;
          timestamp?: string;
          recipient_id?: string;
          errors?: Array<{ message?: string; title?: string }>;
        };
        statuses.push({
          wamid: typeof s.id === "string" ? s.id : undefined,
          status: typeof s.status === "string" ? s.status : undefined,
          timestamp: typeof s.timestamp === "string" ? s.timestamp : undefined,
          recipientId: typeof s.recipient_id === "string" ? s.recipient_id : undefined,
          error: Array.isArray(s.errors) && s.errors[0]
            ? (s.errors[0].message ?? s.errors[0].title)
            : undefined,
          phoneNumberId,
          raw: st,
        });
      }
    }
  }
  return { messages, statuses };
}
