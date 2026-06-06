# Proptimizr — System Documentation

Multi-tenant real-estate CRM/ERP for Pakistani agencies and developers. Production: **crm.proptimizr.com**.

---

## 1. Technology Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.2.6 (App Router, RSC, Server Actions, Turbopack) |
| Language | TypeScript 5 |
| UI | React 19.2, Tailwind CSS 4, Recharts (charts), Leaflet / react-leaflet (maps) |
| Auth | Auth.js (NextAuth v5 beta.31) — credentials provider, JWT sessions |
| Data | Prisma 6.2 + PostgreSQL |
| Validation | Zod (every server-action boundary) |
| AI | `@anthropic-ai/sdk` 0.100 — Claude Opus 4.7 (`claude-opus-4-7`) |
| Background work | Postgres-backed job queue (no Redis), cron-driven |
| Messaging | WhatsApp Cloud API (Meta Graph `v21.0`) |
| i18n | English + Urdu (RTL), localized digits, PKR formatting |
| Hosting | Single VPS, PM2 single-fork, GitHub Actions deploy |

---

## 2. Architecture Overview

```
                       ┌────────────────────────────────────────┐
   Browser ──HTTPS──►  │  Next.js 16 (App Router)               │
                       │  ┌──────────┐  ┌──────────────────────┐│
                       │  │ proxy.ts │  │  (app) RSC pages +   ││
                       │  │ auth gate│─►│  Server Actions      ││
                       │  └──────────┘  └──────────┬───────────┘│
                       │                           │            │
                       │   src/lib  ◄──────────────┘            │
                       │   (rbac, scope, session, business)     │
                       └───────────┬───────────────┬────────────┘
                                   │               │
                          ┌────────▼──────┐  ┌─────▼───────────┐
                          │  PostgreSQL   │  │  Anthropic API  │
                          │  (Prisma)     │  │  (Claude Opus)  │
                          └───────▲───────┘  └─────────────────┘
                                  │
   Cron (1/min) ──Bearer──► /api/jobs/tick ──► job runner + sweeps
   Meta WhatsApp ──HMAC──► /api/webhooks/whatsapp ──► enqueue jobs
```

- **Server-first.** Pages are React Server Components; mutations run through Server Actions guarded by `requireUser`/`requireCapability` + Zod. Client components are limited to interactive widgets (`src/components/ui/*`, charts, map).
- **Tenant isolation** is enforced in application code, not the database: nearly every row carries `companyId`, and every query is wrapped with a role/tenant `where` fragment from `src/lib/scope.ts`.
- **No external queue/cache.** Background work, rate limiting, and AI budget tracking all live in Postgres or in-process memory.

---

## 3. Multi-Tenancy & Roles

### Tenancy
- Every tenant is a **`Company`**. Almost all models carry `companyId`; deleting a Company cascades its records.
- **`SUPER_ADMIN`** users have `companyId = null` and operate across all tenants (platform console).
- Composite indexes are `[companyId, …]`-leading so tenant-scoped queries never table-scan.

### Roles (`Role` enum)

| Role | Scope |
|---|---|
| `SUPER_ADMIN` | Entire platform — `/admin/companies`, `/admin/jobs` |
| `OWNER` | Full visibility of own company |
| `ADMIN` | Daily operations within one company |
| `AGENT` | Only their own leads, properties, calendar, visits |
| `DEALER` | Only their own inventory, deals, and commission share |

### RBAC (`src/lib/rbac.ts`)
Capability → allowed-roles map, checked with `can(role, capability)`; `requireCapability(cap)` redirects to `/dashboard` on denial.

| Capability | Roles |
|---|---|
| `manageCompanies` | SUPER_ADMIN |
| `manageUsers` | SUPER_ADMIN, OWNER, ADMIN |
| `manageProperties` | all except none (incl. AGENT, DEALER) |
| `assignLeadsCalendars` | SUPER_ADMIN, OWNER, ADMIN |
| `updateLeadsVisits` | SUPER_ADMIN, OWNER, ADMIN, AGENT |
| `recordDeals` | SUPER_ADMIN, OWNER, ADMIN |
| `setCommissionRules` | SUPER_ADMIN, OWNER |
| `approveCommission` | SUPER_ADMIN, OWNER, ADMIN |
| `viewCompanyReports` | SUPER_ADMIN, OWNER, ADMIN |
| `managePayments` | SUPER_ADMIN, OWNER, ADMIN |
| `manageDocuments` | SUPER_ADMIN, OWNER, ADMIN, AGENT, DEALER |

### Data scoping (`src/lib/scope.ts`)
Query-time `where` fragments per role:
- **`propertyScope`** — OWNER/ADMIN: whole company; AGENT: assigned (`agents.some.agentId`); DEALER: own (`dealerId`).
- **`leadScope`** — OWNER/ADMIN: all; AGENT: own (`agentId`).
- **`dealScope`** — OWNER/ADMIN: all; AGENT: linked deals; DEALER: deals where they hold a stake.

---

## 4. Authentication & Session

- **Provider:** credentials (email + bcrypt). `authorize` rejects `SUSPENDED` users at login. (`src/auth.ts`)
- **Strategy:** JWT, **8h** max age, **1h** sliding refresh.
- **Token/session claims:** `id`, `role`, `companyId` (+ `email`, `name`). Types in `src/types/next-auth.d.ts`.
- **Proxy gate (`src/proxy.ts`):** protects everything except `/api/auth`, `/api/jobs`, `/api/webhooks`, `/api/public`, static assets, and the public surface. Anonymous users → `/login?from=<path>`; logged-in users hitting `/login` → `/dashboard`.
- **Suspension enforcement (`src/lib/user-status.ts`):** 60s in-memory status cache re-checked on every render via `requireUser`; non-ACTIVE → `/login?reason=suspended`. `touchUserSeen` throttles `lastSeenAt` writes to ≤1/min. SUPER_ADMIN bypasses suspension.
- **Session helpers (`src/lib/session.ts`):** `requireUser()`, `requireCompanyUser()` (forces `companyId`, bounces SUPER_ADMIN to admin console), `requireCapability(cap)`, `isScopedToSelf(role)`.

---

## 5. Data Model

PostgreSQL via Prisma. Models grouped by domain (all tenant-scoped via `companyId` unless noted).

### Tenancy & users
- **Company** — tenant root. Plan/billing (`plan`, `status`, `billingStatus`, `trialEndsAt`, `renewalAt`), branding (`refPrefix`, `brandColor`, `logoUrl`, footers), AI switch (`aiEnabled`), WhatsApp config (`whatsappPhoneId`, `whatsappAccessToken` — **AES-256-GCM encrypted**, `whatsappBusinessAccountId`), `settings` JSON. `slug` unique.
- **User** — `email` globally unique, `passwordHash`, `role`, `status`, `lastSeenAt`. `companyId` nullable (SUPER_ADMIN). Indexed `[companyId, role]`.

### Inventory
- **Project** — development grouping (off-plan support).
- **Property** — listing. `reference` unique per tenant (`[companyId, reference]`), `type`, `listingType`, `status`, geo (`latitude`/`longitude`), pricing (`salePrice`/`monthlyRent`/`deposit`), size with `areaUnit` (incl. **MARLA/KANAL**), supply (`dealerId`, `ownerName`/`ownerPhone`), commission rule, **public share** (`shareSlug`, `shareEnabled`, `sharedById`).
- **PropertyMedia** — PHOTO/VIDEO/FLOOR_PLAN/BROCHURE.
- **PropertyAgent** — multi-agent junction (composite PK `[propertyId, agentId]`).

### CRM
- **Client** — contact record.
- **Lead** — pipeline (`stage`, `source`, budget, `prefType`/`prefArea`, `requirements`, `scoreOverride`, `lastContactedAt`, `importSource`). Indexed `[companyId, stage, updatedAt]`.
- **CalendarEvent** — SHOWING / MEETING / FOLLOW_UP / OPEN_HOUSE / PAYMENT_REMINDER / DOCUMENT_REMINDER / RENTAL_RENEWAL / DEAL_CLOSING; status SCHEDULED/DONE/CANCELLED/MISSED.
- **Showing** — physical visit with GPS check-in/out, `interestLevel`, `verification` status. **GpsLog** — IN/OUT pings.

### Deals, payments, commission
- **Deal** — `reference` unique per tenant, `type`, `status`, `agreement`. 1:1 **Sale** / **Rental** financial detail. **DealAgent** junction (MAIN/CO_AGENT).
- **Payment** — TOKEN/BOOKING/DOWN_PAYMENT/INSTALMENT/RENT/DEPOSIT/COMMISSION; status PENDING/PARTIAL/PAID/OVERDUE.
- **Invoice** — `number` unique per tenant; DRAFT/ISSUED/PAID/CANCELLED.
- **CommissionRule** — split percentages (main/company/other/dealer) + `noOtherFallback`.
- **Commission** — 1:1 per deal, approval workflow (DRAFT → PENDING_APPROVAL → APPROVED → PAID). **CommissionShare** — per-party breakdown.

### Supporting
- **Dealer** — supplier/broker, optional linked `User`, `defaultSharePct`.
- **Document** — polymorphic (property/client/dealer/deal), typed, verification + `expiryDate`.
- **ActivityLog** — immutable audit trail (`action`, `entityType`, `entityId`, `meta` JSON). Never auto-purged.
- **Notification** — per-user; IN_APP default, EMAIL/SMS/WHATSAPP reserved.
- **Job** — queue row (`companyId` nullable for platform jobs). `[type, idempotencyKey]` unique.
- **AiSuggestion** — AI output cache + token accounting (`inputHash`, `promptTokens`, `completionTokens`, `cachedTokens`).
- **WhatsAppTemplate** — local mirror of Meta-approved templates; `[companyId, name, language]` unique.

### Referential behavior
- **Cascade:** Company → all children; Property → media/agents; Deal → DealAgent/Commission/Shares.
- **SetNull (history preserved):** deleting a Lead/Client/Deal nulls references in Payment, Invoice, CalendarEvent, Showing, Document — accounting and audit survive entity deletion.
- **Soft-delete analogs:** `PropertyStatus.INACTIVE`/`PENDING_VERIFICATION`, `Showing.verification = FLAGGED`, `User.status = SUSPENDED`.

> Full enum list (Role, PropertyType, LeadStage, DealStatus, PaymentType, etc.) lives in `prisma/schema.prisma`.

---

## 6. Route Map

### Public / unauthenticated
| Route | Purpose |
|---|---|
| `/login` | Login form (shows suspension notice on `?reason=suspended`) |
| `/p/[slug]` | **Public property listing** — share-token scoped, no auth; hides all internal data |
| `/api/public/property-media/[slug]/[mediaId]` | Token-scoped media proxy for shared listings |
| `/api/webhooks/whatsapp` | Meta webhook (GET verify, POST events) |

### Authenticated app (`src/app/(app)/`)
| Route | Shows | Gate |
|---|---|---|
| `/dashboard` | Role-specific dashboard (Owner/Admin/Agent/Dealer) | company user |
| `/properties`, `/properties/new`, `/[id]` | Inventory list/detail/edit + media | `propertyScope`, `manageProperties` |
| `/map` | Leaflet map of properties | company user |
| `/leads`, `/new`, `/[id]`, `/import` | Pipeline list/detail, CSV import, AI panel | `leadScope`, `assignLeadsCalendars` |
| `/deals`, `/new`, `/[id]` | Deal list/detail + commission breakdown | `dealScope`, `recordDeals` |
| `/commissions`, `/[id]` | Commission shares & approval | scoped by role |
| `/invoices`, `/[id]` · `/payments` | Billing & payment aging | office roles / `managePayments` |
| `/calendar` · `/visits` | Events / visit log | agent-scoped |
| `/agents`, `/[id]` · `/dealers`, … | People directories & performance | `viewCompanyReports` / `manageUsers` |
| `/documents` | Document library | company user (dealers see own) |
| `/reports` · `/activity` | Analytics dashboards / audit log | `viewCompanyReports` |
| `/whatsapp` | Message inbox | `assignLeadsCalendars` |
| `/notifications` · `/settings` · `/search` | Alerts / company config / global search | per role |
| `/admin/companies` · `/admin/jobs` | Platform console / queue inspector | SUPER_ADMIN |
| `/receipts/[id]` | Print-friendly payment receipt | authenticated, company-scoped |

### API routes
| Route | Method | Purpose / Auth |
|---|---|---|
| `/api/auth/[...nextauth]` | GET/POST | NextAuth handler |
| `/api/upload` | POST | Tenant file upload; session + rate-limit (30/min) + 10MB + virus scan |
| `/api/files/[...path]` | GET | Tenant-scoped file serve (first segment = companyId; traversal-guarded) |
| `/api/export` | GET | CSV export (`type=agents|deals|payments|…`); `viewCompanyReports` |
| `/api/jobs/tick` | POST/GET | Queue drain + sweeps; Bearer `JOBS_TICK_TOKEN`, timing-safe |
| `/api/webhooks/whatsapp` | GET/POST | Verify token / HMAC-SHA256 (`WHATSAPP_APP_SECRET`) |
| `/api/signout` | POST | Sign out → `/login` |

---

## 7. Background Jobs

Postgres-backed queue, no Redis. (`src/lib/jobs/`)

- **Enqueue** (`enqueueJob`): `{type, payload?, companyId?, runAt?, maxAttempts=3, idempotencyKey?}`. Unique `(type, idempotencyKey)` dedupes webhook retries (returns existing job id).
- **Job types:** `trial.expire`, `whatsapp.inbound`, `whatsapp.outbound`, `whatsapp.status`, `test.echo`.
- **Runner** (`runDueJobs`): atomically claims QUEUED rows where `runAt ≤ now` (status→RUNNING + `claimedAt`), processes ≤**20/tick** sequentially. Retry with exponential backoff (`60s · 2^attempts` → 1m/2m/4m); exhausted → FAILED. Errors capped at 500 chars.
- **Cron driver** (`/api/jobs/tick`, every minute), ordered: ① stuck-job reaper → ② trial-expiry sweep → ③ queue drain → ④ purge (1/day) → ⑤ WhatsApp token probe (1/day) → ⑥ WhatsApp template catalog (1/day). Daily steps throttled in-process (safe under single PM2 fork).

### Sweeps (`src/lib/jobs/sweeps.ts`, idempotent)
| Sweep | Action |
|---|---|
| `sweepStuckJobs` | RUNNING > 5min → requeue (+30s) or FAIL |
| `sweepExpiredTrials` | TRIAL past `trialEndsAt` → `billingStatus = PAST_DUE`, logs per tenant |
| `purgeOldRows` | DONE jobs > 30d, read notifications > 90d, AiSuggestions > 30d deleted; FAILED jobs & ActivityLog kept |
| `sweepWhatsAppTokens` | Probe each tenant's Meta token; log `whatsapp.token_invalid` on failure |
| `sweepWhatsAppTemplateCatalog` | Refresh approved-template mirror from Meta |

---

## 8. AI Subsystem

`src/lib/ai/`. Model centralized as `AI_MODEL = "claude-opus-4-7"` (`client.ts`); switchable to `claude-sonnet-4-6` in one line. Defaults: `max_tokens` 800, adaptive thinking (reasoning content not surfaced). Client returns `null` when `ANTHROPIC_API_KEY` is absent (fail-closed).

### Pipeline (`runAi`)
1. **Budget gate** (`budget.ts`) — monthly per-plan call caps: FREE 0, TRIAL 25, STARTER 100, GROWTH 1 000, PRO ∞. Requires API key + plan quota + `company.aiEnabled`. Cache hits don't burn budget.
2. **Cache lookup** — SHA-256 of (system, prompt, inputs); reuses recent `AiSuggestion` within per-handler TTL.
3. **Call** — Anthropic `messages.create`, system prompt at an ephemeral cache breakpoint.
4. **Persist** — write `AiSuggestion` with content (4 KB cap) + token counts.

### Handlers (`src/lib/ai/handlers/`)
| Handler | Output | TTL |
|---|---|---|
| `suggestLeadNextAction` | Recommended next action + bullets (Markdown) | 30 min |
| `draftLeadReply` | WhatsApp reply draft (plain text, optional steer) | 60 s |
| `generateOwnerWeeklyInsight` | Owner weekly narrative + actions (Markdown) | 6 h |
| `classifyInboundWhatsApp` | JSON intent/urgency/lead-summary/pref hints — **direct SDK call** (pre-tenant, tolerant JSON parse + validated fallbacks) | — |

---

## 9. WhatsApp Integration

Meta Cloud API `v21.0`. (`src/lib/whatsapp.ts`, `wa-business.ts`, `wa-templates.ts`)

- **Inbound webhook** (`/api/webhooks/whatsapp`): GET verifies `hub.verify_token` against `WHATSAPP_VERIFY_TOKEN`; POST validates `X-Hub-Signature-256` HMAC against `WHATSAPP_APP_SECRET` (timing-safe), routes by `phone_number_id → Company.whatsappPhoneId`, enqueues `whatsapp.inbound` (key = wamid) / `whatsapp.status` (key = `wamid:status`). Always returns 200.
- **Outbound** (`sendWhatsAppText`, `sendWhatsAppTemplate`): POST to `graph.facebook.com/v21.0/{phoneId}/messages`, 20s timeout, never throws (returns `{ok,status,error}`). 4xx errors don't retry; 5xx/network do (via runner backoff).
- **Tokens:** `Company.whatsappAccessToken` stored AES-256-GCM encrypted (`src/lib/crypto.ts`); decrypted per send. Daily probe surfaces expiry in the activity feed.
- **Templates:** catalog synced from Meta into `WhatsAppTemplate`; media-header templates flagged unsupported. Static helper library (`TEMPLATES`) builds localized message bodies (e.g. `newLeadFollowUp`, `propertyDetails`, `siteVisitConfirmation`, `paymentReminder`).
- **Phone normalization:** `normalizePhone` → E.164 without `+`, defaulting country code 92 (Pakistan).

---

## 10. Business Logic

| Helper | File | Summary |
|---|---|---|
| **Lead scoring** | `lead-score.ts` | 0–100 score → HOT/WARM/COLD from stage (dominant), source, budget/property, recency, showing, interest. CLOSED_LOST = 0. Admin override forces band, keeps raw score. |
| **Property matching** | `lead-matching.ts` | Top-N available properties by type/area/budget fit (weighted, fuzzy over-fetch) with reasons. |
| **Lead health** | `lead-health.ts` | FRESH/ATTENTION/STALE/URGENT from per-stage staleness windows; unassigned = URGENT; closed = FRESH. |
| **Auto follow-ups** | `lead-followups.ts` | Schedules a FOLLOW_UP CalendarEvent per stage cadence (NEW 24h, CONTACTED 48h, INTERESTED 72h) if none pending. |
| **Commission** | `commission.ts` | Splits total across main/company/other/dealer; reassigns missing parties per fallback; rounding absorbed into first share; always sums to total. |
| **Plans/limits** | `plans.ts` | Per-plan caps on users/properties/storage; `canAddUser`/`canAddProperty`; usage snapshot. |
| **Rate limiting** | `rate-limit.ts` | In-process sliding window (swap for Redis if clustered). |
| **Uploads** | `uploads.ts`, `uploads/scan.ts` | 10MB cap, extension allowlist, sanitized names, pluggable virus scan (currently stub, fail-closed). |
| **Share tokens** | `share.ts` | 96-bit url-safe `shareSlug`; rewrites file URLs to public proxy path. |
| **Crypto** | `crypto.ts` | AES-256-GCM envelope keyed off SHA-256(`AUTH_SECRET`); tolerates legacy plaintext. |

---

## 11. Internationalization

- Cookie **`pz-locale`** (`en` | `ur`); `getLocale`/`getDict` (`src/lib/i18n/`).
- Urdu renders **RTL** (root layout sets `dir`); Inter (en) / Noto Sans Arabic (ur) fonts.
- Localized digits and PKR currency formatting (`src/lib/format.ts`).

---

## 12. Environment & Operations

### Key environment variables
| Var | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection |
| `AUTH_SECRET` | NextAuth signing **and** AES-256-GCM key derivation (mandatory) |
| `AUTH_TRUST_HOST` | NextAuth host trust |
| `ANTHROPIC_API_KEY` | Claude API (AI fail-closed without it) |
| `JOBS_TICK_TOKEN` | Bearer auth for `/api/jobs/tick` |
| `WHATSAPP_VERIFY_TOKEN` | Webhook verification handshake |
| `WHATSAPP_APP_SECRET` | Webhook HMAC validation |

### Local development
1. Postgres (Docker), `.env` from `.env.example`.
2. `npx prisma db push` → `npm run db:seed` (seeded logins e.g. `owner@proptimizr.test` / `password`; **seed IDs randomize each run**).
3. `npm run dev`.

Scripts: `db:push`, `db:migrate`, `db:seed`, `db:studio`, `test` (node test runner), `typecheck`, `lint`.

### Deployment
- Push to `origin/main` triggers `.github/workflows/deploy.yml` → SSH to VPS → `deploy/redeploy.sh` (`git reset --hard`, `npm ci`, `prisma db push`, `npm run build`, `pm2 reload`), ~1.5 min. **A local commit changes nothing until pushed.**
- Cron on the VPS calls `/api/jobs/tick` every minute with the Bearer token.
- Operational runbooks: `deploy/DEPLOY.md`, `deploy/JOBS.md`, `deploy/AI.md`, `deploy/BACKUP.md`, `deploy/ROTATION.md`.

> ⚠️ **Framework note:** this is a customized Next.js 16 — consult `node_modules/next/dist/docs/` and `AGENTS.md` before changing framework-level code; conventions may differ from upstream.
