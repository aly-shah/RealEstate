"use client";

import { useActionState } from "react";
import { useState, useTransition } from "react";
import {
  createUser,
  updateCommissionRule,
  updateCompanyBranding,
  updateIntegrations,
  type FormState,
} from "./actions";
import { syncWhatsappTemplates } from "./whatsapp-actions";

interface RuleDefaults {
  mainAgentPct: number;
  companyPct: number;
  otherAgentPct: number;
  dealerPct: number;
  noOtherFallback: string;
}

export function CommissionRuleForm({ defaults }: { defaults: RuleDefaults }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateCommissionRule, {});

  return (
    <form action={action} className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div><label className="label" htmlFor="mainAgentPct">Main agent %</label><input id="mainAgentPct" name="mainAgentPct" type="number" min="0" max="100" step="0.5" defaultValue={defaults.mainAgentPct} className="field" /></div>
        <div><label className="label" htmlFor="companyPct">Company %</label><input id="companyPct" name="companyPct" type="number" min="0" max="100" step="0.5" defaultValue={defaults.companyPct} className="field" /></div>
        <div><label className="label" htmlFor="otherAgentPct">Co-agents %</label><input id="otherAgentPct" name="otherAgentPct" type="number" min="0" max="100" step="0.5" defaultValue={defaults.otherAgentPct} className="field" /></div>
        <div><label className="label" htmlFor="dealerPct">Dealer %</label><input id="dealerPct" name="dealerPct" type="number" min="0" max="100" step="0.5" defaultValue={defaults.dealerPct} className="field" /></div>
      </div>
      <div>
        <label className="label" htmlFor="noOtherFallback">If there are no co-agents, their share goes to</label>
        <select id="noOtherFallback" name="noOtherFallback" className="field max-w-xs" defaultValue={defaults.noOtherFallback}>
          <option value="MAIN">The main agent</option>
          <option value="COMPANY">The company</option>
        </select>
      </div>
      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      {state.ok && <p className="text-sm text-ok">Saved.</p>}
      <button type="submit" disabled={pending} className="btn-accent">{pending ? "Saving…" : "Save split rule"}</button>
    </form>
  );
}

export function NewUserForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(async (p, fd) => {
    const res = await createUser(p, fd);
    return res;
  }, {});

  return (
    <form action={action} className="space-y-4" key={state.ok ? "reset" : "form"}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="label" htmlFor="name">Name</label><input id="name" name="name" className="field" required /></div>
        <div><label className="label" htmlFor="email">Email</label><input id="email" name="email" type="email" className="field" required /></div>
        <div><label className="label" htmlFor="password">Temporary password</label><input id="password" name="password" type="text" className="field" required minLength={6} /></div>
        <div><label className="label" htmlFor="phone">Phone</label><input id="phone" name="phone" className="field" /></div>
        <div>
          <label className="label" htmlFor="role">Role</label>
          <select id="role" name="role" className="field" defaultValue="AGENT">
            <option value="AGENT">Agent</option>
            <option value="ADMIN">Admin</option>
            <option value="DEALER">Dealer</option>
          </select>
        </div>
      </div>
      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      {state.ok && <p className="text-sm text-ok">User created.</p>}
      <button type="submit" disabled={pending} className="btn-primary">{pending ? "Creating…" : "Add user"}</button>
    </form>
  );
}

interface BrandingDefaults {
  brandColor: string | null;
  timezone: string | null;
  logoUrl: string | null;
  invoiceFooter: string | null;
  receiptFooter: string | null;
  whatsappSignature: string | null;
}

/**
 * OWNER-only branding form. Empty fields clear the override (the render layer
 * falls back to platform defaults). Color uses a native picker for a
 * frictionless experience; logoUrl accepts a path — wiring the existing
 * Uploader would also work but isn't required for the MVP.
 */
export function BrandingForm({ defaults }: { defaults: BrandingDefaults }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateCompanyBranding, {});

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="brandColor">Brand accent color</label>
          <div className="flex items-center gap-2">
            <input
              id="brandColor"
              name="brandColor"
              type="color"
              defaultValue={defaults.brandColor ?? "#4f46e5"}
              className="h-10 w-14 cursor-pointer rounded-md border border-line bg-white"
            />
            <input
              type="text"
              defaultValue={defaults.brandColor ?? ""}
              onChange={(e) => {
                const picker = document.getElementById("brandColor") as HTMLInputElement | null;
                if (picker && /^#[0-9a-f]{6}$/i.test(e.target.value)) picker.value = e.target.value;
              }}
              placeholder="#4f46e5"
              className="field max-w-[160px]"
              aria-label="Hex code"
            />
          </div>
          <p className="mt-1 text-xs text-muted">Used on invoice headers and the brand mark. Leave default to inherit indigo.</p>
        </div>

        <div>
          <label className="label" htmlFor="timezone">Timezone (IANA)</label>
          <input
            id="timezone"
            name="timezone"
            defaultValue={defaults.timezone ?? ""}
            placeholder="Asia/Karachi"
            className="field"
          />
          <p className="mt-1 text-xs text-muted">Empty falls back to server local time.</p>
        </div>

        <div className="sm:col-span-2">
          <label className="label" htmlFor="logoUrl">Logo URL</label>
          <input
            id="logoUrl"
            name="logoUrl"
            defaultValue={defaults.logoUrl ?? ""}
            placeholder="/api/files/<companyId>/your-logo.png"
            className="field"
          />
          <p className="mt-1 text-xs text-muted">
            Upload via the Documents page, then paste the returned URL here. Empty falls back to the wordmark.
          </p>
        </div>

        <div className="sm:col-span-2">
          <label className="label" htmlFor="invoiceFooter">Invoice footer</label>
          <textarea
            id="invoiceFooter"
            name="invoiceFooter"
            rows={2}
            maxLength={500}
            defaultValue={defaults.invoiceFooter ?? ""}
            placeholder="Thank you for your business. Bank details on file."
            className="field resize-none"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="label" htmlFor="receiptFooter">Receipt footer</label>
          <textarea
            id="receiptFooter"
            name="receiptFooter"
            rows={2}
            maxLength={500}
            defaultValue={defaults.receiptFooter ?? ""}
            placeholder="Payment received with thanks."
            className="field resize-none"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="label" htmlFor="whatsappSignature">WhatsApp signature</label>
          <input
            id="whatsappSignature"
            name="whatsappSignature"
            maxLength={280}
            defaultValue={defaults.whatsappSignature ?? ""}
            placeholder="Capital Crest Estates · www.example.com"
            className="field"
          />
          <p className="mt-1 text-xs text-muted">
            Replaces the default <code className="kbd">{`{agent} — {company}`}</code> closer on WhatsApp templates.
          </p>
        </div>
      </div>

      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      {state.ok && <p className="text-sm text-ok">Saved.</p>}

      <button type="submit" disabled={pending} className="btn-accent">
        {pending ? "Saving…" : "Save branding"}
      </button>
    </form>
  );
}

interface IntegrationsDefaults {
  whatsappPhoneId: string | null;
  whatsappBusinessAccountId: string | null;
  hasWhatsappToken: boolean;
  aiEnabled: boolean;
  aiServerConfigured: boolean;
}

/**
 * OWNER-only integrations form. Two surfaces in one save:
 *   - WhatsApp Business API credentials (phone_number_id + access token).
 *     The stored token is never echoed back to the client; the input
 *     shows "•••• stored" as placeholder when present and "Disconnect"
 *     wipes it via the __CLEAR__ sentinel.
 *   - AI master switch (disables every AI surface for this tenant
 *     regardless of plan).
 */
export function IntegrationsForm({ defaults }: { defaults: IntegrationsDefaults }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateIntegrations, {});

  // Local UI state: which token mode are we in? "kept" (placeholder
  // shown, submitted as empty so the server preserves the existing
  // value), "rotate" (operator wants to enter a new value), "clear"
  // (operator wants to wipe — submitted as __CLEAR__).
  type Mode = "kept" | "rotate" | "clear";
  const [tokenMode, setTokenMode] = useState<Mode>(defaults.hasWhatsappToken ? "kept" : "rotate");

  const tokenInputValue =
    tokenMode === "clear" ? "__CLEAR__" : tokenMode === "kept" ? "" : undefined;

  return (
    <form action={action} className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-ink">WhatsApp Business API</h3>
        <p className="text-xs text-muted">
          Required for outbound sends. Inbound messages route by phone number ID
          even without a token (read-only mode).
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="whatsappPhoneId">Phone number ID</label>
          <input
            id="whatsappPhoneId"
            name="whatsappPhoneId"
            defaultValue={defaults.whatsappPhoneId ?? ""}
            placeholder="123456789012345"
            className="field font-mono text-sm"
            maxLength={64}
          />
          <p className="mt-1 text-xs text-muted">
            From Meta Business Manager → WhatsApp → Account → API setup.
          </p>
        </div>

        <div>
          <label className="label" htmlFor="whatsappBusinessAccountId">Business Account ID (WABA)</label>
          <input
            id="whatsappBusinessAccountId"
            name="whatsappBusinessAccountId"
            defaultValue={defaults.whatsappBusinessAccountId ?? ""}
            placeholder="987654321098765"
            className="field font-mono text-sm"
            maxLength={64}
          />
          <p className="mt-1 text-xs text-muted">
            From the same page — used to fetch approved templates.
          </p>
        </div>

        <div>
          <label className="label" htmlFor="whatsappAccessToken">Access token</label>
          {tokenMode === "kept" ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value="•••• stored"
                readOnly
                className="field font-mono text-sm text-muted"
              />
              <button
                type="button"
                onClick={() => setTokenMode("rotate")}
                className="btn-ghost px-2 py-1 text-xs"
              >
                Replace
              </button>
              <button
                type="button"
                onClick={() => setTokenMode("clear")}
                className="btn-ghost px-2 py-1 text-xs text-danger"
              >
                Disconnect
              </button>
            </div>
          ) : tokenMode === "clear" ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value="(will be cleared on save)"
                readOnly
                className="field font-mono text-sm text-danger"
              />
              <button
                type="button"
                onClick={() => setTokenMode("kept")}
                className="btn-ghost px-2 py-1 text-xs"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <input
                id="whatsappAccessToken"
                name="whatsappAccessToken"
                type="password"
                placeholder="EAAG…"
                className="field font-mono text-sm"
                maxLength={500}
                autoComplete="off"
              />
              {defaults.hasWhatsappToken && (
                <button
                  type="button"
                  onClick={() => setTokenMode("kept")}
                  className="btn-ghost px-2 py-1 text-xs"
                >
                  Cancel
                </button>
              )}
            </div>
          )}
          {/* Hidden synced field for "kept" and "clear" modes — when in
              "rotate" mode the visible input itself is the source. */}
          {tokenInputValue !== undefined && (
            <input type="hidden" name="whatsappAccessToken" value={tokenInputValue} />
          )}
          <p className="mt-1 text-xs text-muted">
            Long-lived token from the same API setup page. Never echoed back —
            replace or disconnect to rotate.
          </p>
        </div>
      </div>

      <hr className="border-line-soft" />

      <div>
        <h3 className="text-sm font-semibold text-ink">AI assistant</h3>
        <p className="text-xs text-muted">
          Master switch for every AI surface (lead suggestions, weekly insight,
          WhatsApp classifier). Plan-budget enforcement still applies on top.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="aiEnabled"
          defaultChecked={defaults.aiEnabled}
          className="h-4 w-4 rounded border-line"
        />
        <span>Enable AI features for this workspace</span>
      </label>
      {!defaults.aiServerConfigured && (
        <p className="text-xs text-warn">
          Server-side <code className="kbd">ANTHROPIC_API_KEY</code> isn't set —
          AI surfaces stay hidden even when this is checked.
        </p>
      )}

      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      {state.ok && <p className="text-sm text-ok">Saved.</p>}

      <button type="submit" disabled={pending} className="btn-accent">
        {pending ? "Saving…" : "Save integrations"}
      </button>
    </form>
  );
}

export interface TemplateRow {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  paramCount: number;
  bodyText: string;
  syncedAt: Date | string;
}

/**
 * Standalone "Sync templates" affordance + read-only list of the
 * currently-mirrored WhatsApp templates. Lives alongside the
 * IntegrationsForm so the owner can save credentials in one form and
 * then trigger the catalog pull from the other. Re-clicking is cheap
 * and idempotent.
 */
export function WhatsappTemplatesPanel({
  templates,
  canSync,
}: {
  templates: TemplateRow[];
  canSync: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  function trigger() {
    setFeedback(null);
    startTransition(async () => {
      const r = await syncWhatsappTemplates();
      setFeedback(
        r.ok
          ? { tone: "ok", text: `Fetched ${r.fetched ?? 0} template(s); pruned ${r.pruned ?? 0}.` }
          : { tone: "err", text: r.reason ?? "Sync failed." },
      );
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted">
          Pull the latest approved templates from Meta. Only <code className="kbd">APPROVED</code>
          {" "}templates appear in the lead-page send dropdown.
        </p>
        <button
          type="button"
          onClick={trigger}
          disabled={!canSync || pending}
          className="btn-ghost text-xs"
          title={canSync ? undefined : "Set the WhatsApp Business Account ID + access token first."}
        >
          {pending ? "Syncing…" : "Sync templates"}
        </button>
      </div>

      {feedback && (
        <p
          className={`rounded-lg border px-3 py-2 text-xs ${
            feedback.tone === "ok"
              ? "border-ok/25 bg-ok-bg text-ok"
              : "border-danger/25 bg-danger-bg text-danger"
          }`}
        >
          {feedback.text}
        </p>
      )}

      {templates.length === 0 ? (
        <p className="text-xs text-muted">
          No templates synced yet. Click "Sync templates" once credentials are saved.
        </p>
      ) : (
        <ul className="divide-y divide-line-soft text-sm">
          {templates.map((t) => (
            <li key={t.id} className="py-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-ink">
                  {t.name} <span className="text-muted">· {t.language}</span>
                </span>
                <span
                  className={`chip text-xs ${
                    t.status === "APPROVED"
                      ? "border-ok/25 bg-ok-bg text-ok"
                      : t.status === "REJECTED"
                        ? "border-danger/25 bg-danger-bg text-danger"
                        : "border-warn/25 bg-warn-bg text-warn"
                  }`}
                >
                  {t.status}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted">
                {t.category} · {t.paramCount} parameter{t.paramCount === 1 ? "" : "s"}
              </p>
              <p className="mt-1 whitespace-pre-wrap rounded bg-line-soft/40 px-2 py-1 font-mono text-xs text-slate">
                {t.bodyText.slice(0, 240)}
                {t.bodyText.length > 240 ? "…" : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

