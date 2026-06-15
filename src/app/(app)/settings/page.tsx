import { requireCapability } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { ROLE_LABELS } from "@/lib/rbac";
import { toNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { Table, Td } from "@/components/ui/Table";
import { StatusBadge } from "@/components/ui/Badge";
import {
  CommissionRuleForm,
  NewUserForm,
  BrandingForm,
  IntegrationsForm,
  LeadRoutingForm,
  WhatsappTemplatesPanel,
  WhatsappAutomationForm,
} from "./SettingsForms";
import { setUserStatus } from "./actions";
import { planUsageSnapshot } from "@/lib/plans";
import { aiUsageSnapshot } from "@/lib/ai/budget";
import { fmtDate } from "@/lib/format";

/** Small "used / limit" bar for the plan-usage panel. */
function UsageBar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const isUncapped = !Number.isFinite(limit);
  const pct = isUncapped ? 0 : Math.min(100, Math.round((used / Math.max(limit, 1)) * 100));
  const tone = pct >= 90 ? "bg-danger" : pct >= 70 ? "bg-warn" : "bg-accent";
  return (
    <div className="rounded-lg border border-line bg-line-soft/60 px-3 py-2 text-xs">
      <p className="font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-ink">
        <span className="font-semibold">{used.toLocaleString()}</span>
        <span className="text-muted"> / {isUncapped ? "unlimited" : limit.toLocaleString()}</span>
      </p>
      {!isUncapped && (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line">
          <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

export default async function SettingsPage() {
  const user = await requireCapability("manageUsers");
  const companyId = user.companyId!;

  const [users, rule, company, usage, ai, templates, contractAutomation] = await Promise.all([
    prisma.user.findMany({ where: { companyId }, orderBy: { createdAt: "asc" } }),
    prisma.commissionRule.findFirst({ where: { companyId, isDefault: true } }),
    prisma.company.findUnique({
      where: { id: companyId },
      select: {
        brandColor: true, timezone: true, logoUrl: true,
        invoiceFooter: true, receiptFooter: true, whatsappSignature: true,
        // Phase 9.5 — integrations panel reads the phone id + whether a
        // token is stored. The token value itself is never sent to the
        // client; we surface only the boolean.
        whatsappPhoneId: true, whatsappAccessToken: true, aiEnabled: true,
        // Risk-fix follow-up: WABA id drives template-catalog sync.
        whatsappBusinessAccountId: true,
        leadRoutingStrategy: true,
      },
    }),
    planUsageSnapshot(companyId),
    aiUsageSnapshot(companyId),
    prisma.whatsAppTemplate.findMany({
      where: { companyId },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      select: {
        id: true, name: true, language: true, category: true,
        status: true, paramCount: true, bodyText: true, syncedAt: true,
      },
    }),
    prisma.whatsAppAutomation.findUnique({
      where: { companyId_event: { companyId, event: "CONTRACT_VERIFY" } },
      select: { templateName: true, language: true },
    }),
  ]);

  const defaults = {
    mainAgentPct: rule ? toNumber(rule.mainAgentPct) : 50,
    companyPct: rule ? toNumber(rule.companyPct) : 25,
    otherAgentPct: rule ? toNumber(rule.otherAgentPct) : 25,
    dealerPct: rule ? toNumber(rule.dealerPct) : 0,
    noOtherFallback: rule?.noOtherFallback ?? "MAIN",
  };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Configuration" title="Settings" subtitle="Manage your team, branding and the commission rules that drive payouts." />

      {/* Phase 8: plan usage snapshot — visible to every office viewer so they
          know where the tenant stands before they hit a "limit reached" error. */}
      {usage && (
        <Section title={`Plan · ${usage.planLabel}`}>
          <div className="grid gap-4 sm:grid-cols-3">
            <UsageBar label="Users" used={usage.users.used} limit={usage.users.limit} />
            <UsageBar label="Properties" used={usage.properties.used} limit={usage.properties.limit} />
            <div className="rounded-lg border border-line bg-line-soft/60 px-3 py-2 text-xs">
              <p className="font-semibold uppercase tracking-wide text-muted">Billing</p>
              <p className="mt-1 text-ink">{usage.billingStatus.replace(/_/g, " ").toLowerCase()}</p>
              {usage.trialEndsAt && (
                <p className="text-muted">Trial ends {fmtDate(usage.trialEndsAt)}</p>
              )}
              {usage.renewalAt && (
                <p className="text-muted">Renews {fmtDate(usage.renewalAt)}</p>
              )}
            </div>
          </div>
          <p className="mt-3 text-xs text-muted">
            Limits are enforced on create. Contact your provider to upgrade.
          </p>
        </Section>
      )}

      {can(user.role, "setCommissionRules") && (
        <Section title="Default commission split">
          <p className="mb-4 text-sm text-muted">These percentages apply to every deal unless a property overrides them. They must total 100%.</p>
          <CommissionRuleForm defaults={defaults} />
        </Section>
      )}

      {can(user.role, "assignLeadsCalendars") && company && (
        <Section title="Lead routing">
          <p className="mb-4 text-sm text-muted">
            Choose how incoming unassigned leads are auto-assigned. Manual keeps the current
            behaviour — leads wait in the list for you to assign.
          </p>
          <LeadRoutingForm strategy={company.leadRoutingStrategy} />
        </Section>
      )}

      {/* Branding lives below commission rules — only the Owner sees the form. */}
      {user.role === "OWNER" && company && (
        <Section title="Branding &amp; locale">
          <p className="mb-4 text-sm text-muted">Per-tenant overrides for the colour, logo, invoice/receipt footers and WhatsApp signature.</p>
          <BrandingForm
            defaults={{
              brandColor: company.brandColor,
              timezone: company.timezone,
              logoUrl: company.logoUrl,
              invoiceFooter: company.invoiceFooter,
              receiptFooter: company.receiptFooter,
              whatsappSignature: company.whatsappSignature,
            }}
          />
        </Section>
      )}

      {/* Phase 9.5 — Integrations: WhatsApp Business API + AI master switch.
          OWNER-only because these are commercial / outward-facing settings. */}
      {user.role === "OWNER" && company && (
        <Section title="Integrations">
          <p className="mb-4 text-sm text-muted">
            Connect the WhatsApp Business API so agents can send messages from the lead
            page; toggle AI assistance for the whole workspace.
          </p>
          <IntegrationsForm
            defaults={{
              whatsappPhoneId: company.whatsappPhoneId,
              whatsappBusinessAccountId: company.whatsappBusinessAccountId,
              hasWhatsappToken: !!company.whatsappAccessToken,
              aiEnabled: company.aiEnabled,
              aiServerConfigured: !!ai && ai.serverConfigured,
            }}
          />
        </Section>
      )}

      {user.role === "OWNER" && company && (
        <Section title="WhatsApp templates">
          <WhatsappTemplatesPanel
            templates={templates}
            canSync={!!company.whatsappBusinessAccountId && !!company.whatsappAccessToken}
          />
        </Section>
      )}

      {user.role === "OWNER" && company && (
        <Section title="WhatsApp automation">
          <p className="mb-4 text-sm text-muted">
            Map an approved template to an automated message so it delivers over WhatsApp even
            outside the 24-hour window.
          </p>
          <WhatsappAutomationForm
            approved={templates.filter((t) => t.status === "APPROVED").map((t) => ({ name: t.name, language: t.language }))}
            current={contractAutomation}
          />
        </Section>
      )}

      <Section title="Add a team member">
        <NewUserForm />
      </Section>

      <Section title="Users">
        <Table head={["Name", "Email", "Role", "Status", ""]}>
          {users.map((u) => {
            const isSelf = u.id === user.id;
            const isSuperAdmin = u.role === "SUPER_ADMIN";
            const canToggle = !isSelf && !isSuperAdmin;
            const nextStatus = u.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
            return (
              <tr key={u.id} className="hover:bg-line-soft">
                <Td className="font-medium text-ink">
                  {u.name}
                  {isSelf && <span className="ms-2 text-xs text-muted">(you)</span>}
                </Td>
                <Td className="text-xs">{u.email}</Td>
                <Td>{ROLE_LABELS[u.role]}</Td>
                <Td><StatusBadge status={u.status} /></Td>
                <Td>
                  {canToggle ? (
                    <form action={setUserStatus}>
                      <input type="hidden" name="userId" value={u.id} />
                      <input type="hidden" name="status" value={nextStatus} />
                      <button className="btn-ghost px-2 py-1 text-xs">
                        {u.status === "ACTIVE" ? "Suspend" : "Reactivate"}
                      </button>
                    </form>
                  ) : (
                    <span className="text-xs text-muted">—</span>
                  )}
                </Td>
              </tr>
            );
          })}
        </Table>
      </Section>
    </div>
  );
}
