import Link from "next/link";
import { requireCapability } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { fmtDateTime, humanize } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { Table, Td } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { parsePage } from "@/lib/pagination";
import { WhatsAppReplies } from "./WhatsAppReplies";

/**
 * Phase-9.5 follow-up — WhatsApp inbox. Reads ActivityLog rows produced
 * by the inbound webhook + outbound handlers and groups them by
 * conversation (sender phone). Each row shows the latest message
 * preview, the AI classification (intent/urgency from Phase 9), and
 * delivery status for outbound sends.
 *
 * Tenant-scoped via requireCapability("viewCompanyReports") — same
 * gate as the activity log. AGENTs don't get this view yet; their
 * leads-page WhatsApp panel covers their personal flow.
 *
 * Conversation grouping is done in-memory after the SQL pull. With the
 * 90-day TTL on activity logs the per-tenant working set stays small
 * (typical: <1000 rows); pagination over conversations rather than
 * raw rows keeps the UI tidy.
 */

interface ConversationRow {
  phone: string;
  /** Most recent activity log entry across all directions. */
  latest: {
    createdAt: Date;
    action: string;
    summary: string;
    intent: string | null;
    urgency: string | null;
  };
  totalCount: number;
  inboundCount: number;
  outboundCount: number;
}

const WHATSAPP_ACTIONS = [
  "whatsapp.inbound",
  "whatsapp.sent",
  "whatsapp.send_queued",
  "whatsapp.send_failed",
  "whatsapp.delivered",
  "whatsapp.read",
  "whatsapp.delivery_failed",
];

const CONVERSATIONS_PER_PAGE = 20;

export default async function WhatsappInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; pageSize?: string; phone?: string }>;
}) {
  const user = await requireCapability("viewCompanyReports");
  const companyId = user.companyId!;
  const sp = await searchParams;
  const { page, pageSize, skip } = parsePage(sp, CONVERSATIONS_PER_PAGE);

  // If a phone filter is provided, drill into that conversation. Otherwise
  // pull the most recent 500 WhatsApp actions for this tenant and group.
  const phoneFilter = (sp.phone ?? "").trim();

  if (phoneFilter) {
    const rows = await prisma.activityLog.findMany({
      where: {
        companyId,
        action: { in: WHATSAPP_ACTIONS },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    // In-memory filter — most tenants have <500 rows total; switching to
    // a JSON-path Postgres index isn't worth it at this volume.
    const filtered = rows.filter((r) => matchesPhone(r.meta, phoneFilter));
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="WhatsApp"
          title={`Conversation · ${phoneFilter}`}
          subtitle="All inbound and outbound activity for this number."
          action={
            <Link href="/whatsapp" className="btn-ghost text-sm">
              ← Back to inbox
            </Link>
          }
        />
        {filtered.length === 0 ? (
          <Section title="No messages">
            <EmptyState
              title="Nothing to show"
              hint="This number has no activity in the last 90 days."
            />
          </Section>
        ) : (
          <Section title="Copilot">
            <WhatsAppReplies phone={phoneFilter} />
          </Section>
        )}
        {filtered.length > 0 && (
          <Section title="Timeline">
            <ul className="divide-y divide-line-soft">
              {filtered.map((r) => (
                <li key={r.id} className="py-3">
                  <div className="flex items-center justify-between gap-2">
                    <Badge tone={directionTone(r.action)}>
                      {directionLabel(r.action)}
                    </Badge>
                    <span className="text-xs text-muted">{fmtDateTime(r.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-sm text-ink">{r.summary}</p>
                  {classificationChips(r.meta)}
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    );
  }

  // Default — list of conversations.
  const rows = await prisma.activityLog.findMany({
    where: {
      companyId,
      action: { in: WHATSAPP_ACTIONS },
    },
    orderBy: { createdAt: "desc" },
    // Cap the working set so a runaway tenant doesn't OOM the page. 500
    // rows × ~60d activity ≈ 8 conversations/day at the cap — plenty.
    take: 500,
  });

  const byPhone = new Map<string, ConversationRow>();
  for (const r of rows) {
    const phone = extractPhone(r.meta);
    if (!phone) continue;
    const intent = readMetaString(r.meta, "classification", "intent");
    const urgency = readMetaString(r.meta, "classification", "urgency");
    const existing = byPhone.get(phone);
    if (existing) {
      existing.totalCount += 1;
      if (r.action === "whatsapp.inbound") existing.inboundCount += 1;
      else existing.outboundCount += 1;
    } else {
      byPhone.set(phone, {
        phone,
        latest: {
          createdAt: r.createdAt,
          action: r.action,
          summary: r.summary,
          intent,
          urgency,
        },
        totalCount: 1,
        inboundCount: r.action === "whatsapp.inbound" ? 1 : 0,
        outboundCount: r.action === "whatsapp.inbound" ? 0 : 1,
      });
    }
  }

  const sorted = [...byPhone.values()].sort(
    (a, b) => b.latest.createdAt.getTime() - a.latest.createdAt.getTime(),
  );
  const pageItems = sorted.slice(skip, skip + pageSize);

  // Copilot insights for the visible conversations (one row per company+phone).
  const insightRows = pageItems.length
    ? await prisma.whatsAppConversationInsight.findMany({
        where: { companyId, phone: { in: pageItems.map((c) => c.phone) } },
        select: { phone: true, intent: true, urgency: true, sentiment: true, suggestedAction: true, leadId: true },
      })
    : [];
  const insightByPhone = new Map(insightRows.map((i) => [i.phone, i]));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="WhatsApp"
        title="Inbox"
        subtitle={`${sorted.length} conversation${sorted.length === 1 ? "" : "s"} across the last 90 days.`}
      />

      {pageItems.length === 0 ? (
        <Section title="No conversations yet">
          <EmptyState
            title="Nothing inbound yet"
            hint="As Meta routes WhatsApp messages to this workspace they'll appear here."
          />
        </Section>
      ) : (
        <Section title="Recent conversations">
          <Table head={["Phone", "Last message", "AI insight", "Counts", "When", ""]}>
            {pageItems.map((c) => {
              const ai = insightByPhone.get(c.phone);
              const intent = ai?.intent ?? c.latest.intent;
              const urgency = ai?.urgency ?? c.latest.urgency;
              const risk = conversationRisk(c.latest.action, c.latest.createdAt, ai);
              return (
                <tr key={c.phone} className="hover:bg-line-soft">
                  <Td className="text-sm">
                    <span className="font-mono">{c.phone}</span>
                    {risk && <div className="mt-1"><Badge tone={risk.tone}>{risk.label}</Badge></div>}
                  </Td>
                  <Td className="max-w-[28ch] text-sm">
                    <p className="truncate" title={c.latest.summary}>{c.latest.summary}</p>
                    {ai?.suggestedAction && (
                      <p className="mt-0.5 truncate text-xs text-accent" title={ai.suggestedAction}>💡 {ai.suggestedAction}</p>
                    )}
                  </Td>
                  <Td>
                    {intent || urgency || ai?.sentiment ? (
                      <div className="flex flex-wrap gap-1">
                        {intent && <Badge tone="accent">{humanize(intent)}</Badge>}
                        {urgency && <Badge tone={urgencyTone(urgency)}>{humanize(urgency)}</Badge>}
                        {ai?.sentiment && ai.sentiment !== "NEUTRAL" && (
                          <Badge tone={sentimentTone(ai.sentiment)}>{humanize(ai.sentiment)}</Badge>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    )}
                  </Td>
                  <Td className="text-xs text-muted">↓ {c.inboundCount} · ↑ {c.outboundCount}</Td>
                  <Td className="text-xs text-muted whitespace-nowrap">{fmtDateTime(c.latest.createdAt)}</Td>
                  <Td>
                    {ai?.leadId ? (
                      <Link href={`/leads/${ai.leadId}`} className="btn-ghost px-2 py-1 text-xs">Lead →</Link>
                    ) : (
                      <Link href={`/whatsapp?phone=${encodeURIComponent(c.phone)}`} className="btn-ghost px-2 py-1 text-xs">Open</Link>
                    )}
                  </Td>
                </tr>
              );
            })}
          </Table>
          <Pagination page={page} pageSize={pageSize} total={sorted.length} />
        </Section>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────── helpers

function extractPhone(meta: unknown): string | null {
  if (!meta || typeof meta !== "object") return null;
  const m = meta as Record<string, unknown>;
  // Inbound: meta.from. Outbound: meta.toPhone. Status: meta from the
  // original send is not always present; we fall back to the wamid
  // grouping less reliably and skip rather than guess.
  const from = typeof m.from === "string" ? m.from : null;
  const to = typeof m.toPhone === "string" ? m.toPhone : null;
  return from ?? to ?? null;
}

function matchesPhone(meta: unknown, phone: string): boolean {
  return extractPhone(meta) === phone;
}

function readMetaString(meta: unknown, ...keys: string[]): string | null {
  let cur: unknown = meta;
  for (const k of keys) {
    if (!cur || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[k];
  }
  return typeof cur === "string" ? cur : null;
}

function directionLabel(action: string): string {
  if (action === "whatsapp.inbound") return "Inbound";
  if (action === "whatsapp.sent") return "Sent";
  if (action === "whatsapp.send_queued") return "Queued";
  if (action === "whatsapp.send_failed") return "Send failed";
  if (action === "whatsapp.delivered") return "Delivered";
  if (action === "whatsapp.read") return "Read";
  if (action === "whatsapp.delivery_failed") return "Delivery failed";
  return action;
}

function directionTone(action: string): "accent" | "ok" | "warn" | "danger" | "neutral" {
  if (action === "whatsapp.inbound") return "accent";
  if (action === "whatsapp.delivered" || action === "whatsapp.sent") return "ok";
  if (action === "whatsapp.read") return "ok";
  if (action === "whatsapp.send_queued") return "neutral";
  if (action === "whatsapp.send_failed" || action === "whatsapp.delivery_failed") return "danger";
  return "neutral";
}

function urgencyTone(u: string): "ok" | "warn" | "danger" {
  return u === "HIGH" ? "danger" : u === "MEDIUM" ? "warn" : "ok";
}

function sentimentTone(s: string): "ok" | "neutral" | "danger" {
  return s === "POSITIVE" ? "ok" : s === "NEGATIVE" ? "danger" : "neutral";
}

/** Follow-up risk for a conversation — surfaced as a triage badge. Reads the
 *  clock internally so it isn't an impure call in the page's render body. */
function conversationRisk(
  latestAction: string,
  latestAt: Date,
  insight: { urgency?: string | null; intent?: string | null } | undefined,
): { label: string; tone: "danger" | "warn" | "neutral" } | null {
  if (insight?.intent === "NOT_INTERESTED") return { label: "Likely lost", tone: "neutral" };
  // The client is waiting only when the most recent message was inbound.
  if (latestAction !== "whatsapp.inbound") return null;
  const days = (Date.now() - latestAt.getTime()) / 86_400_000;
  if (days >= 3) return { label: "No reply in 3 days", tone: "danger" };
  if (insight?.urgency === "HIGH" || insight?.intent === "VISIT") return { label: "Hot lead waiting", tone: "danger" };
  if (days >= 1) return { label: "Awaiting reply", tone: "warn" };
  return null;
}

function classificationChips(meta: unknown) {
  const intent = readMetaString(meta, "classification", "intent");
  const urgency = readMetaString(meta, "classification", "urgency");
  const summary = readMetaString(meta, "classification", "lead_summary");
  if (!intent && !urgency && !summary) return null;
  return (
    <div className="mt-2 space-y-1">
      <div className="flex flex-wrap gap-1">
        {intent && <Badge tone="accent">{humanize(intent)}</Badge>}
        {urgency && <Badge tone={urgencyTone(urgency)}>{humanize(urgency)}</Badge>}
      </div>
      {summary && <p className="text-xs text-muted italic">{summary}</p>}
    </div>
  );
}
