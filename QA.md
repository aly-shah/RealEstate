# QA — manual release checklist

Run this before every push to `main`. The `npm test` suite covers pure
functions; this checklist covers everything that needs a browser, a real
database, or a third-party round-trip.

## 0. Build sanity (5 min, automated)

```bash
npm install
npx prisma generate
npm run typecheck   # tsc --noEmit; should be clean
npm test            # node:test suite under test/
npx prisma validate # schema sanity
```

A failure here is a blocker — fix before touching the browser.

## 1. Tenant isolation (10 min)

Two browsers, two tenants. Confirm:

- [ ] Owner of tenant A cannot see any leads, properties, deals, payments,
      documents or notifications belonging to tenant B (URL-guessing IDs
      from B in browser A returns 404, not the record).
- [ ] An agent in A cannot read another agent's leads even within A
      (`/leads` only lists their own; deep-link to a peer's lead returns
      404 via `requireCompanyUser` + `agentId` filter).
- [ ] Activity log for A never includes events from B.
- [ ] Reports for A never include B's revenue / leads / agents.
- [ ] `/admin/companies` only loads as SUPER_ADMIN; all other roles bounce.
- [ ] Switching a session's `companyId` via the URL has no effect — the
      authoritative source is `requireCompanyUser`.

## 2. RBAC (10 min)

For each role, log in and confirm:

| Role | Should see | Should NOT see |
|------|-----------|----------------|
| OWNER | Everything in their tenant including settings, plan, commission rules | Other tenants |
| ADMIN | Same as Owner minus commission rule editing + plan billing | Other tenants |
| AGENT | Only their own leads/visits/calendar; properties tab read-only outside their list | Reports, deals, commissions, settings |
| DEALER | Only their own inventory + dealer dashboard | Reports, settings, other agents' leads |
| SUPER_ADMIN | Platform console only | Tenant screens (gets redirected to `/admin/companies`) |

`npm test` covers the capability matrix; this is the click-through.

## 3. Lead lifecycle (15 min)

- [ ] Create a lead from `/leads/new` with all fields. Stage advances
      correctly through the 9-stage pipeline. Stage drops trigger the
      lost-reason prompt.
- [ ] Score badge updates when stage changes; manual HOT/WARM/COLD
      override pins the band and reasons surface in the tooltip.
- [ ] Health badge flips between FRESH/ATTENTION/STALE/URGENT as
      `lastContactedAt` ages; an unassigned lead reads URGENT.
- [ ] `recordShowing` from `/visits` bumps `lastContactedAt` on every
      active lead for that client + the matching lead's `leadId` gets
      populated (new in Phase 10).
- [ ] Property matches sidebar shows ranked suggestions; "Attach"
      links a property to the lead.

## 4. AI surfaces (only if `ANTHROPIC_API_KEY` is set — 10 min)

- [ ] Open any lead → right rail shows **AI assistant** panel.
- [ ] "Suggest next action" returns a coherent 1-2 bullet recommendation
      within ~5s. Click again → "cached" pill appears, no API call burned.
- [ ] "Draft WhatsApp reply" returns a 2-4 sentence draft. Steering box
      changes the output. "Regenerate" produces a fresh draft.
- [ ] `/reports` → **AI · weekly insight** section. Click "Generate
      weekly insight" → Markdown narrative with bullets + "What to do
      next" action list.
- [ ] Set `Company.aiEnabled = false` via Prisma Studio → both panels
      disappear for that tenant only.
- [ ] Burn through the plan budget (FREE = 0; TRIAL = 25) → click shows
      "Your plan includes N AI calls per month; you've used N." Toast
      surfaces with no Claude call made.

## 5. WhatsApp webhook (5 min — requires `WHATSAPP_APP_SECRET`)

- [ ] GET `/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=…&hub.challenge=abc`
      with the matching token → returns `abc`.
- [ ] POST a Meta-shaped payload with valid `X-Hub-Signature-256` →
      200 OK; a `Job` row appears in QUEUED.
- [ ] Same payload again → returns existing job id (idempotency dedup
      via `wamid`).
- [ ] Payload with a `phone_number_id` matching a tenant's
      `whatsappPhoneId` → the resulting Job + ActivityLog rows carry
      that tenant's `companyId`. Unknown phone_number_id → `companyId = null`
      (platform-level).
- [ ] Bad signature → 401, no job enqueued.

## 6. Mobile pass (10 min — actual phone or DevTools mobile preset)

- [ ] Login fits the viewport at 360×640 with no horizontal scroll.
- [ ] Lead detail page shows the mobile action bar (Call / WhatsApp / Visit)
      fixed at the bottom; main content scrolls.
- [ ] Visit check-in form works (GPS permission prompt fires; manual
      location field accepted when GPS denied).
- [ ] Property cards stack vertically; chart cards keep readable axes.
- [ ] Tap targets ≥ 44×44 px on all action buttons (use Chrome's
      "Show ruler on hover").

## 7. i18n (5 min)

- [ ] Switch locale to Urdu via the menu → layout flips RTL.
- [ ] Digits in money values render as Urdu numerals (۰-۹).
- [ ] Currency suffix shows روپے instead of `PKR`.
- [ ] Reference numbers (`CHR-0123` / `PROP-0001`) keep ASCII digits (carry
      `data-keep-latin`).
- [ ] Date/time pills remain readable; chart legends fall back to English
      where the dictionary entry is absent.

## 8. Background jobs (5 min — requires `JOBS_TICK_TOKEN`)

- [ ] `curl -H "Authorization: Bearer $JOBS_TICK_TOKEN" /api/jobs/tick`
      returns `{ok: true, …}`.
- [ ] No bearer / wrong bearer → 401.
- [ ] Set a tenant's `Company.trialEndsAt` to yesterday + plan = TRIAL.
      Hit the tick → `billingStatus` flips to PAST_DUE.
- [ ] Manually flip a QUEUED job to RUNNING + set `claimedAt` to 10 min
      ago. Hit the tick → reaper resets it to QUEUED (or FAILED if
      budget exhausted).

## 9. Backups (verify, don't run — 2 min)

- [ ] `deploy/backup.sh` cron is installed (`crontab -l` shows it).
- [ ] Latest daily dump exists under `/var/backups/proptimizr/`.
- [ ] Retention tiers (14 daily / 8 weekly / 6 monthly) honoured.

## 10. Smoke deploy (15 min, only on staging)

- [ ] If any new SQL file appears under `deploy/migrations/`, run it
      against staging via `psql` **before** the `prisma db push` step.
      The scripts use `CREATE/DROP INDEX CONCURRENTLY` so live writes
      keep flowing on hot tables (`ActivityLog`, `Payment`).
- [ ] `git pull && npm ci && npx prisma db push && npm run build && pm2 reload proptimizr-crm`
      completes with no errors.
- [ ] Site loads at `https://<staging-domain>/`; login works; one
      page from each module renders without 500s.
- [ ] `pm2 logs proptimizr-crm --lines 50` shows no unexpected errors.
- [ ] No INVALID indexes lingering:
      `SELECT i.relname FROM pg_class i JOIN pg_index ix ON ix.indexrelid=i.oid WHERE NOT ix.indisvalid;`
      returns zero rows.

---

If any item in §1, §2, or §10 fails, **do not deploy**. Items in §4-§9
can be down-graded to "create a follow-up ticket" depending on severity.
