import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireCompanyUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { compactMoney, humanize, fmtDateTime, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { StatusBadge } from "@/components/ui/Badge";
import { Timeline } from "@/components/ui/Timeline";
import { StageControl, AssignControl } from "@/components/lead/LeadControls";
import { scoreLeadWithViews } from "@/lib/lead-score";
import { leadHealth } from "@/lib/lead-health";
import { findPropertyMatches } from "@/lib/lead-matching";
import { LeadHealthBadge } from "@/components/lead/LeadHealthBadge";
import { LeadScoreBadge } from "@/components/lead/LeadScoreBadge";
import { ScoreOverrideControl } from "@/components/lead/ScoreOverrideControl";
import { PropertyMatches } from "@/components/lead/PropertyMatches";
import { WhatsAppButton } from "@/components/whatsapp/WhatsAppButton";
import { MobileLeadActions } from "@/components/lead/MobileLeadActions";
import { TEMPLATES } from "@/lib/whatsapp";
import { LeadAiPanel } from "@/components/lead/LeadAiPanel";
import { WhatsAppSend } from "@/components/lead/WhatsAppSend";
import { setClientConsent } from "@/app/(app)/leads/actions";
import { aiUsageSnapshot } from "@/lib/ai/budget";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireCompanyUser();

  const lead = await prisma.lead.findFirst({
    where: {
      id,
      companyId: user.companyId,
      ...(user.role === "AGENT" ? { agentId: user.id } : {}),
    },
    include: {
      client: true,
      agent: true,
      property: true,
      events: { orderBy: { startAt: "desc" }, take: 10 },
      // Phase 4 signals — used for scoring + health computation below.
      showings: { select: { interestLevel: true } },
      _count: {
        select: {
          events: { where: { startAt: { gt: new Date() }, status: "SCHEDULED" } },
        },
      },
    },
  });
  if (!lead) notFound();

  const [activity, agents, matches, company, ai, waTemplates] = await Promise.all([
    prisma.activityLog.findMany({
      where: { companyId: user.companyId, entityType: "LEAD", entityId: id },
      include: { user: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    can(user.role, "assignLeadsCalendars")
      ? prisma.user.findMany({ where: { companyId: user.companyId, role: "AGENT" }, select: { id: true, name: true } })
      : [],
    // Skip the suggestion query for closed leads — saves a roundtrip and
    // matches what the UI shows anyway (we hide the section).
    lead.stage === "CLOSED_WON" || lead.stage === "CLOSED_LOST"
      ? Promise.resolve([])
      : findPropertyMatches(
          {
            companyId: user.companyId,
            prefType: lead.prefType,
            prefArea: lead.prefArea,
            budgetMin: lead.budgetMin,
            budgetMax: lead.budgetMax,
            propertyId: lead.propertyId,
          },
          5,
        ),
    // Need the company name + WhatsApp signature override for templates,
    // and the booleans that gate the Phase-9.5 "Send via WhatsApp"
    // panel (rendered only when both credentials are set).
    prisma.company.findUnique({
      where: { id: user.companyId },
      select: {
        name: true,
        whatsappSignature: true,
        whatsappPhoneId: true,
        whatsappAccessToken: true,
      },
    }),
    // Phase-9: plan-gated AI surface. Snapshot tells us whether to render
    // the assistant panel at all (server has no key / plan excludes AI /
    // owner switched it off).
    aiUsageSnapshot(user.companyId),
    // Phase-9.5 risk-fix: APPROVED templates feed the lead-page send
    // dropdown. Empty list ⇒ template mode shows a "no templates,
    // sync from Settings" hint.
    prisma.whatsAppTemplate.findMany({
      where: { companyId: user.companyId, status: "APPROVED" },
      select: {
        name: true,
        language: true,
        paramCount: true,
        bodyText: true,
        headerText: true,
        headerParamCount: true,
      },
      orderBy: { name: "asc" },
    }),
  ]);

  // Show the AI panel only when the server is configured AND the plan
  // includes AI AND the owner hasn't switched it off. Agents on excluded
  // plans never see the entry point, so the upgrade nudge stays on the
  // settings page where it belongs.
  const showAi = !!ai && ai.serverConfigured && ai.aiEnabled && ai.limit > 0;

  // Phase 9.5 — outbound WhatsApp only renders when both halves of the
  // Meta Cloud API credentials are configured. The booleans are derived
  // server-side so we never leak the token to the client.
  const canSendWhatsapp = !!company?.whatsappPhoneId && !!company?.whatsappAccessToken;

  // Highest interest level across showings (mirrors the list-page helper).
  const interestRank: Record<string, number> = { HIGH: 4, MEDIUM: 3, LOW: 2, NONE: 1 };
  const topInterest = lead.showings.reduce<null | "HIGH" | "MEDIUM" | "LOW" | "NONE">(
    (best, s) =>
      s.interestLevel && (best == null || interestRank[s.interestLevel] > interestRank[best])
        ? (s.interestLevel as "HIGH" | "MEDIUM" | "LOW" | "NONE")
        : best,
    null,
  );

  const score = await scoreLeadWithViews(
    {
      stage: lead.stage,
      source: lead.source,
      hasBudget: !!(lead.budgetMin || lead.budgetMax),
      hasProperty: !!lead.propertyId,
      updatedAt: lead.updatedAt,
      hasShowing: lead.showings.length > 0,
      topInterest,
      override: lead.scoreOverride,
    },
    { companyId: user.companyId, clientId: lead.clientId },
  );
  const health = leadHealth({
    stage: lead.stage,
    lastContactedAt: lead.lastContactedAt,
    createdAt: lead.createdAt,
    unassigned: !lead.agentId,
    hasFutureEvent: lead._count.events > 0,
  });

  const canAssign = can(user.role, "assignLeadsCalendars");
  const canConsent = can(user.role, "updateLeadsVisits");
  const optedOut = lead.client?.marketingOptOut ?? false;

  // Re-used between the header WhatsApp pill and the mobile action bar.
  const waMessage = TEMPLATES.newLeadFollowUp({
    clientName: lead.client?.name,
    agentName: lead.agent?.name,
    companyName: company?.name ?? "the team",
    signature: company?.whatsappSignature,
    source: lead.source,
  });

  return (
    <div>
      <PageHeader
        eyebrow="Lead"
        title={lead.client?.name ?? "Unnamed lead"}
        subtitle={[lead.client?.phone, lead.client?.email].filter(Boolean).join(" · ") || undefined}
        action={
          <div className="flex items-center gap-2">
            <WhatsAppButton
              phone={lead.client?.phone}
              label="WhatsApp client"
              size="md"
              message={waMessage}
            />
            <LeadHealthBadge health={health.health} reasons={health.reasons} size="md" />
            <LeadScoreBadge band={score.band} score={score.score} overridden={score.overridden} reasons={score.reasons} />
            <StatusBadge status={lead.stage} />
          </div>
        }
      />

      {optedOut && (
        <p className="mb-4 rounded-xl border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger">
          🚫 <span className="font-semibold">Do-not-contact:</span> this client opted out of marketing. Automated sequences are paused — avoid promotional messages.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Section title="Requirements & preferences">
            <dl className="grid gap-x-8 sm:grid-cols-2">
              <div className="flex justify-between border-b border-line-soft py-2 text-sm"><dt className="text-muted">Source</dt><dd className="font-medium text-ink">{humanize(lead.source)}</dd></div>
              <div className="flex justify-between border-b border-line-soft py-2 text-sm"><dt className="text-muted">Budget</dt><dd className="font-medium text-ink">{lead.budgetMax ? `≤ ${compactMoney(lead.budgetMax)}` : "—"}</dd></div>
              <div className="flex justify-between border-b border-line-soft py-2 text-sm"><dt className="text-muted">Preferred area</dt><dd className="font-medium text-ink">{lead.prefArea ?? "—"}</dd></div>
              <div className="flex justify-between border-b border-line-soft py-2 text-sm"><dt className="text-muted">Property</dt><dd className="font-medium text-ink">{lead.property ? <Link href={`/properties/${lead.property.id}`} className="text-accent">{lead.property.title}</Link> : "—"}</dd></div>
            </dl>
            {lead.requirements && <p className="mt-3 text-sm text-slate">{lead.requirements}</p>}
            {lead.lostReason && <p className="mt-3 rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">Lost: {lead.lostReason}</p>}
          </Section>

          {/* Property matches — only shown for active leads */}
          {lead.stage !== "CLOSED_WON" && lead.stage !== "CLOSED_LOST" && (
            <Section title="Suggested properties">
              <PropertyMatches leadId={lead.id} matches={matches} />
            </Section>
          )}

          <Section title="Upcoming & past events">
            {lead.events.length === 0 ? (
              <p className="text-sm text-muted">No calendar events linked.</p>
            ) : (
              <ul className="divide-y divide-line">
                {lead.events.map((e) => (
                  <li key={e.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-ink">{e.title}</span>
                    <span className="text-xs text-muted">{fmtDateTime(e.startAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Activity timeline">
            <Timeline entries={activity.map((a) => ({ id: a.id, summary: a.summary, createdAt: a.createdAt, who: a.user?.name }))} />
          </Section>
        </div>

        <div className="space-y-6 right-rail">
          <Section title="Move the lead">
            <StageControl id={lead.id} current={lead.stage} />
          </Section>

          <Section title="Assigned agent">
            {canAssign ? (
              <AssignControl id={lead.id} currentAgentId={lead.agentId} agents={agents} />
            ) : (
              <p className="text-sm text-ink">{lead.agent?.name ?? "Unassigned"}</p>
            )}
          </Section>

          {showAi && (
            <Section title="AI assistant">
              <LeadAiPanel leadId={lead.id} />
            </Section>
          )}

          {canSendWhatsapp && (
            <Section title="Send WhatsApp">
              <WhatsAppSend leadId={lead.id} templates={waTemplates} />
            </Section>
          )}

          {canAssign && (
            <Section title="Score override">
              <p className="mb-3 text-xs text-muted">
                Pin a band to override the computed score. Falls back to auto when cleared.
              </p>
              <ScoreOverrideControl leadId={lead.id} current={lead.scoreOverride} />
              {score.reasons.length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-muted hover:text-slate">
                    Why this score?
                  </summary>
                  <ul className="mt-2 space-y-1 text-xs text-slate">
                    {score.reasons.map((r) => (
                      <li key={r}>• {r}</li>
                    ))}
                  </ul>
                </details>
              )}
            </Section>
          )}

          {canConsent && lead.clientId && (
            <Section title="Consent">
              {optedOut ? (
                <>
                  <p className="mb-2 rounded-xl border border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger">
                    🚫 Do-not-contact — opted out of marketing
                    {lead.client?.optOutSource ? ` (${lead.client.optOutSource})` : ""}
                    {lead.client?.optOutAt ? ` on ${fmtDate(lead.client.optOutAt)}` : ""}. Automated sequences are paused.
                  </p>
                  <form action={setClientConsent}>
                    <input type="hidden" name="leadId" value={lead.id} />
                    <input type="hidden" name="optOut" value="false" />
                    <button className="btn-ghost w-full justify-center text-xs">Re-subscribe</button>
                  </form>
                </>
              ) : (
                <>
                  <p className="mb-2 text-xs text-muted">
                    Receiving automated marketing (drip sequences). Mark do-not-contact if the client asks to stop.
                  </p>
                  <form action={setClientConsent}>
                    <input type="hidden" name="leadId" value={lead.id} />
                    <input type="hidden" name="optOut" value="true" />
                    <button className="btn-ghost w-full justify-center text-xs text-danger">Mark do-not-contact</button>
                  </form>
                </>
              )}
            </Section>
          )}
        </div>
      </div>

      {/* Mobile-only fixed action bar — Call / WhatsApp / Visit. */}
      <MobileLeadActions
        phone={lead.client?.phone}
        whatsappMessage={waMessage}
        propertyId={lead.propertyId}
      />
    </div>
  );
}
