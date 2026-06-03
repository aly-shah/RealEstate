# Phase 9 — AI features (Claude integration)

This document covers the operational setup for the AI surfaces shipped
in Phase 9: lead "next action" / "draft reply" on the lead detail page,
inbound WhatsApp message classification, and the owner-only weekly
insight on /reports.

All AI calls go through `lib/ai/run.ts`, which gates on plan, master
switch, and `ANTHROPIC_API_KEY` presence. Nothing is called from
prerender / build paths; every surface is request- or job-time.

## Environment variables

```
# Required for every AI surface. Without it, every UI button + the
# WhatsApp classifier silently fall back to the non-AI behaviour
# (panels hidden, classifier returns null) — the app keeps working.
ANTHROPIC_API_KEY=sk-ant-api03-...
```

The key is read by `lib/ai/client.ts` on first use; restart PM2
(`pm2 reload realestate-crm`) after setting it.

## Plan budget

Per-tenant monthly AI call cap, defined in `lib/ai/budget.ts`:

| Plan    | Calls / month |
|---------|---------------|
| FREE    | 0             |
| TRIAL   | 25            |
| STARTER | 100           |
| GROWTH  | 1,000         |
| PRO     | ∞             |

"One call" = one row inserted into `AiSuggestion`. Cache hits (same
input hash within the freshness window) are free — clicking
"Suggest next action" 5 times on the same lead pays once.

Reset is on the 1st of the month, server local time. There's no
backfill — moving a tenant up a plan grants the new ceiling immediately,
counted from rows already created this month.

## Per-tenant master switch

`Company.aiEnabled` (default `true`) flips every AI surface off for a
tenant without changing their plan. Useful for compliance-sensitive
clients or pilots. Toggle from `prisma studio` until a settings UI
ships in a later phase.

## WhatsApp tenant routing

Inbound WhatsApp messages route to the tenant whose `Company.whatsappPhoneId`
matches the `phone_number_id` carried in the Meta Cloud API payload.

To claim a line, paste the **Phone number ID** (from Meta Business Manager →
WhatsApp → Account → API setup) into **Settings → Integrations** as the
OWNER. SQL is also supported for SUPER_ADMIN cutovers:

```sql
UPDATE "Company" SET "whatsappPhoneId" = '1234567890' WHERE id = '<cuid>';
```

The column is `UNIQUE` so two tenants can't claim the same line. Messages
arriving for an unclaimed phone_number_id land at platform level
(`companyId = null` on the Job + ActivityLog rows) — visible in
`/admin/jobs` so ops can prompt the tenant to paste their id.

## Outbound WhatsApp (Phase 9.5)

The same Settings → Integrations panel takes the **Access token** and
**Business Account ID (WABA)** from the API setup page. With those set,
two affordances appear:

1. The "Send WhatsApp" section on every lead detail page (free text mode
   or pre-approved template mode — dropdown of templates).
2. A "Sync templates" button in Settings → WhatsApp templates that pulls
   the latest catalog from
   `GET /v21.0/<wabaId>/message_templates` and mirrors it locally so the
   lead-page dropdown stays correct without re-hitting Meta on every
   render. Re-clicking is cheap + idempotent; deleted templates are
   pruned from the mirror on each sync. A daily catalog sweep runs
   automatically alongside the token probe — the manual button is now
   only needed when an owner wants to pick up a freshly approved
   template before the next 24h cycle.

### Template component support

The send UI handles `BODY` and TEXT-format `HEADER` components — both
the textareas auto-size to the template's parameter count and require
the matching number of input lines before the Send button enables.

Templates with a MEDIA header (image/video/document) are stored with
`status = "UNSUPPORTED_MEDIA_HEADER"` so they show up in the Settings
list (for triage) but are filtered out of the lead-page dropdown.
`BUTTONS` and `FOOTER` components are ignored — Meta sends them
without per-message parameters in our flow, so the rendered message
still includes them with the values defined at template-approval time. The action enqueues a `WHATSAPP_OUTBOUND` job;
the runner POSTs to `graph.facebook.com/v21.0/<phone_number_id>/messages`
and writes the outcome to the activity timeline.

Key constraints (Meta side, surfaced verbatim when they fire):

- **24-hour customer-service window**: free-form text only works if the
  recipient messaged the business in the last 24h. Outside that window,
  Meta requires a pre-approved template — Phase 9.5 ships free-form
  only; templates are a follow-up.
- **Recipient must be on WhatsApp** — Meta returns an error envelope
  the runner captures into `ActivityLog.meta.error`.
- **Tokens expire** — long-lived business tokens last ~60 days unless
  the system user is set up. Rotate via Settings → Integrations →
  Replace.

Failed sends are `maxAttempts: 1` (most failures aren't transient — the
operator needs to read the error and either retry with wa.me or fix the
config); they appear in `/admin/jobs` with the Meta error string for
quick triage.

### At-rest encryption

`Company.whatsappAccessToken` is stored AES-256-GCM-encrypted using a
key derived from `AUTH_SECRET` (SHA-256). Envelope format:

```
enc:v1:<iv-b64u>.<authTag-b64u>.<ciphertext-b64u>
```

Implementation lives in `lib/crypto.ts`. The Settings UI never echoes
the stored token back (shows `•••• stored`); decryption happens only
inside the outbound job handler. The decryptor tolerates legacy
plaintext rows (pre-encryption) and returns them as-is so existing
tenants keep working through the cutover — they're re-encrypted on
next save. Tampered ciphertext returns null, surfacing as a clear
"re-save it in Settings" error rather than a confusing Meta 401.

If `AUTH_SECRET` rotates without prior re-encryption, every stored
token becomes undecryptable. The fail-soft behaviour means outbound
just stops working with a clear error; owners re-paste their token
to recover. Inbound + the rest of the app is unaffected.

To rotate `AUTH_SECRET` cleanly (no per-tenant re-paste), use the
`scripts/reencrypt-tokens.ts` helper documented in
[`deploy/ROTATION.md`](ROTATION.md). The daily token-validity sweep
(`sweepWhatsAppTokens` in `lib/jobs/sweeps.ts`) catches stragglers —
any token that fails decryption or Meta's validity ping shows up in
the tenant's activity feed as `whatsapp.token_invalid` within 24h
without an actual send having to fail first.

### Delivery status callbacks

Meta posts `status` events (sent → delivered → read → failed) for
every outbound message. The webhook extracts both `messages` and
`statuses` arrays from the envelope, enqueues a `WHATSAPP_STATUS`
job per status event (deduped by `wamid:status`), and the handler
writes a corresponding row to the activity timeline (`whatsapp.delivered`,
`whatsapp.read`, `whatsapp.delivery_failed`). The `sent` transition
is intentionally skipped because the outbound handler already logged
`whatsapp.sent` when Meta acked the API call — surfacing it again
would be timeline noise.

Status rows inherit the original send's `entityType`/`entityId` (via
a wamid lookup on the prior `whatsapp.sent` row), so delivery progress
appears on the same lead detail page without any UI work.

## Model selection

Hard-coded in `lib/ai/client.ts` to `claude-opus-4-7` — the most capable
Claude model. Adaptive thinking is on by default (model decides when
to reason). To downgrade for cost (e.g. swap to `claude-sonnet-4-6`),
edit `AI_MODEL` and bounce PM2. No data migration needed.

## SDK version

`package.json` pins `@anthropic-ai/sdk: ^0.65.0`. The integration only
uses long-stable surfaces — `client.messages.create({...})`, the
`thinking: {type: "adaptive"}` flag, and `cache_control: {type: "ephemeral"}`
breakpoints — so any release on the 0.x line that supports adaptive
thinking will work. The WhatsApp classifier deliberately avoids
`output_config.format` (a newer surface) and instructs Claude to emit
JSON via the system prompt, parsed defensively in
`lib/ai/handlers/whatsapp-classify.ts` (`tolerantJsonParse` strips
fences and recovers from prose-wrapped responses).

## Monitoring

Every AI call writes:

1. An `AiSuggestion` row (content + token counts + entity link).
2. An `ActivityLog` entry under `entityType=LEAD` (`ai.lead_next_action`,
   `ai.lead_reply_draft`) or `entityType=COMPANY` (`ai.owner_weekly_insight`).
3. Inbound WhatsApp classifications land on `ActivityLog` under
   `entityType=WHATSAPP` with the parsed intent/urgency in `meta`.

Quick token-usage check (per tenant, current month):

```sql
SELECT type,
       COUNT(*)                      AS calls,
       SUM("promptTokens")           AS prompt_tokens,
       SUM("completionTokens")       AS completion_tokens,
       SUM("cachedTokens")           AS cached_tokens
FROM "AiSuggestion"
WHERE "companyId" = '<id>'
  AND "createdAt" >= date_trunc('month', NOW())
GROUP BY type
ORDER BY calls DESC;
```

`cachedTokens` should be a substantial fraction of `prompt_tokens` once
the prompt cache is warm — that's Anthropic prefix-caching working.

## Failure modes

| Symptom | Cause | Fix |
|--------|-------|-----|
| "AI features are not configured on this server." | `ANTHROPIC_API_KEY` missing | Set the env var, reload PM2. |
| "AI features are disabled for this workspace." | `Company.aiEnabled = false` | Toggle via prisma studio. |
| "Your current plan doesn't include AI assistance." | Plan = FREE | Upgrade the tenant. |
| "Your plan includes N AI calls per month; you've used N." | Monthly cap hit | Wait for the 1st, or upgrade. |
| "AI returned an empty response." | Model refused or the response was empty | Inspect the latest `AiSuggestion` row, or the Anthropic console for the underlying `request_id`. |
| WhatsApp classifications missing | `ANTHROPIC_API_KEY` missing on the box running the jobs cron | Same fix as the first row — the classifier short-circuits to "no classification" rather than failing the job. |

## Costs (rough)

Opus 4.7 input $5/MTok, output $25/MTok. Average call sizes:

- **lead.next_action**: ~600 in + ~200 out ≈ $0.008
- **lead.reply_draft**: ~400 in + ~100 out ≈ $0.005
- **whatsapp.classify**: ~250 in + ~100 out ≈ $0.004
- **owner.weekly_insight**: ~800 in + ~500 out ≈ $0.017

With Anthropic prompt caching (system prompts are cached), the cached
portion drops to ~10% of base — so the above are upper-bound after a
warm cache. A Growth-plan tenant burning their full 1,000 calls/month
on a healthy mix tops out at ~$10/month server-side.

## Disabling AI globally

Unset `ANTHROPIC_API_KEY` and reload PM2. Every panel hides, every
WhatsApp message lands unclassified, and no API calls or DB rows are
created. The non-AI parts of the app are unaffected.
