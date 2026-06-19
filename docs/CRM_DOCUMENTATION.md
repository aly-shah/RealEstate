# Proptimizr CRM — Complete System Documentation

> **Product:** Proptimizr — a multi-tenant real-estate CRM/ERP for the Pakistan market
> **Production:** https://crm.proptimizr.com
> **Audience of this document:** an AI/analyst reviewing the system to suggest improvements
> **Generated:** 2026-06 · grounded in the live codebase (`prisma/schema.prisma`, `src/lib/rbac.ts`, `src/lib/nav.ts`, API routes). Where this differs from older docs (`docs/PROPTIMIZR_BLUEPRINT.md`), this document reflects the **current** state — several features the blueprint lists as "absent/partial" have since been built.

---

## 1. System Overview

Proptimizr is a **WhatsApp-first, multi-tenant** real-estate CRM/ERP. Each customer is a **Company** (tenant); every domain row carries a `companyId` and all queries are tenant-scoped. It manages the full real-estate lifecycle: properties/listings → leads → showings/visits → deals → contracts (with CNIC e-signature) → payments/invoices → commissions, plus marketing automation (drip sequences), a client-facing portal, document generation, and reporting.

**Currency:** PKR. **Locale:** English + Urdu (RTL) via a dictionary system. **Primary channel:** WhatsApp (official Cloud API and an unofficial QR-linked mode).

### 1.1 Tech Stack

| Layer | Technology |
|---|---|
| Framework | **Next.js 16.2** (App Router, React Server Components, Server Actions, Turbopack) |
| UI | **React 19**, **Tailwind CSS 4**, custom design system (`globals.css`) |
| Charts | **recharts** | Maps | **react-leaflet** |
| Auth | **NextAuth v5** (beta) — JWT session, 8-hour `maxAge`; `bcryptjs` password hashing |
| ORM / DB | **Prisma 6** + **PostgreSQL** (schema-push workflow, no migration history; hand-rolled `CONCURRENTLY` index + CHECK-constraint SQL under `deploy/migrations/`) |
| Validation | **zod** |
| AI | **OpenAI** (`@anthropic-ai/sdk` + OpenAI Chat) via a provider abstraction; prod runs OpenAI `gpt-4o-mini` |
| WhatsApp | Meta **Cloud API** (`fetch` against graph.facebook.com) **and** **Baileys** (`@whiskeysockets/baileys`) for QR linking |
| QR | `qrcode` | Runtime | Node.js (PM2 on the VPS) |

### 1.2 Architecture

- **Rendering:** Server Components + Server Actions; route groups `(app)` (authenticated shell) and `(public)` (portal, CNIC verify). A top-level `/deal-documents` group hosts print-friendly documents outside the app chrome.
- **Auth gate:** `src/proxy.ts` (Next "proxy", formerly middleware) bounces anonymous traffic to `/login` except allow-listed public paths (`/login`, `/p/`, `/verify-identity/`, `/portal/`) and matcher-excluded API paths.
- **Background work:** a Postgres-backed **Job queue** drained by `GET/POST /api/jobs/tick`, invoked **every minute** by a root cron on the VPS (`/usr/local/bin/proptimizr-tick.sh`). Drip sequences run every tick; purge / payment-reminders / WhatsApp token+catalog sweeps are **daily-throttled durably** via the `SweepState` table (survives restarts).
- **Multi-tenancy:** enforced at the query layer (`lib/scope.ts`) — every read/write filters by `companyId`. No row-level security in the DB; isolation is application-enforced.

---

## 2. User Roles

Five roles (`Role` enum). One is platform-level; four operate inside a company.

| Role | Scope | Description |
|---|---|---|
| **SUPER_ADMIN** | Platform | Provider/operator. Manages companies + the job queue. Lands on `/admin/companies`. |
| **OWNER** | Company | Full company control incl. commission rules, integrations, billing-aware settings. |
| **ADMIN** | Company | Office manager — most company operations except commission-rule setup + integrations. |
| **AGENT** | Company | Field agent — own leads/visits, properties, deals (view), documents. |
| **DEALER** | Company | External dealer/broker — properties, documents, own deals/commissions. |

Login redirect: `homePathForRole()` → SUPER_ADMIN ⇒ `/admin/companies`, everyone else ⇒ `/dashboard`. Each role also gets a **role-specific dashboard** (`OwnerDashboard`, `AdminDashboard`, `AgentDashboard`, `DealerDashboard`) and AGENT gets a mobile bottom-nav.

---

## 3. Permissions

Capabilities are defined in `src/lib/rbac.ts` as a capability→roles map; `can(role, capability)` gates UI + actions. **"Own"-scoped** restrictions (e.g. an agent only seeing their own leads) are enforced in the query layer, not the capability map.

| Capability | SUPER_ADMIN | OWNER | ADMIN | AGENT | DEALER |
|---|:---:|:---:|:---:|:---:|:---:|
| manageCompanies | ✅ | | | | |
| manageUsers | ✅ | ✅ | ✅ | | |
| manageProperties | ✅ | ✅ | ✅ | ✅ | ✅ |
| assignLeadsCalendars | ✅ | ✅ | ✅ | | |
| updateLeadsVisits | ✅ | ✅ | ✅ | ✅ | |
| recordDeals | ✅ | ✅ | ✅ | | |
| setCommissionRules | ✅ | ✅ | | | |
| approveCommission | ✅ | ✅ | ✅ | | |
| viewCompanyReports | ✅ | ✅ | ✅ | | |
| managePayments | ✅ | ✅ | ✅ | | |
| manageDocuments | ✅ | ✅ | ✅ | ✅ | ✅ |

"Office" = OWNER + ADMIN. Several surfaces (WhatsApp inbox, Sequences, Invoices, Payments, Agents, Dealers, Reports, Activity, Settings) are office-only; some Settings panels (Integrations, WhatsApp, commission rules) are **OWNER-only**.

---

## 4. Modules & Features

Navigation is grouped (`src/lib/nav.ts`): **Workspace · Sales · Field · Finance · People · Insights · System**, filtered per role.

### Workspace
- **Dashboard** — role-specific KPI cards + charts (revenue trend, inventory donut, leads funnel).
- **Properties** — listings (sale/rental, residential/commercial), media (photos/floor-plans), per-listing agents, status lifecycle, public shareable page (`/p/<slug>`) with OG/Twitter rich previews. Create/edit, detail with deals.
- **Map** — Leaflet map of properties.

### Sales
- **Leads** — pipeline (10 stages), source tracking, **heuristic lead scoring** (HOT/WARM/COLD, `lib/lead-score.ts`), **lead health** (stale detection), **lead↔property matching**, CSV/portal import, AI lead-brief (conversation intelligence), consent/DNC, per-client portal link. **Lead routing** strategies: MANUAL, ROUND_ROBIN, TERRITORY_MATCH, SHARK_TANK.
- **Deals** — sale & rental; status machine (DRAFT→NEGOTIATION→TOKEN→BOOKED→AGREEMENT→CLOSED_WON/LOST); **closing checklist** with a gate (can't close-won with required items pending); **forecast & GCI** inputs (gross-commission %, estimated close date); **per-deal close-probability** (calibrated to company history); **document generation** (see §5.4); **CNIC e-signature contracts**.
- **WhatsApp inbox** — inbound message handling surface.
- **Sequences** — multi-step **drip campaigns** (WhatsApp-template + agent-task steps, hour-granularity delays). Visual builder: trigger node → timeline → completion; "currently nurturing" panel; per-status enrolment stats.

### Field
- **Calendar** — `CalendarEvent`s (SHOWING, MEETING, FOLLOW_UP, OPEN_HOUSE, reminders, etc.).
- **Visits** — `Showing`s with GPS check-in/out, verification status, client feedback, interest level.

### Finance
- **Commissions** — `CommissionRule`s + computed `Commission` with `CommissionShare`s (agent/dealer split), approval workflow.
- **Invoices** — issued against deals, auto-promotion, PDF-friendly receipts (`/receipts/[id]`).
- **Payments** — schedule, status (PENDING/PARTIAL/PAID/OVERDUE), **automated due/overdue reminders** (in-app notifications), receipts.

### People
- **Agents** — company users (create, status, detail).
- **Dealers** — external brokers (create, detail, linked deals/commissions).

### Insights
- **Documents** — central library; **generated agreement packs** + uploads; per-row viewer (`/documents/[id]`) that serves real files / generated pages and previews placeholders.
- **Reports** — revenue, source conversion, funnel drop-off, payment aging, inventory aging, visit-verification, **GCI by agent**, **weighted pipeline forecast** (calibrated).
- **Activity log** — tenant audit trail (`ActivityLog`).

### System
- **Notifications** — in-app, unread counts.
- **Settings** — branding & locale, commission split, lead routing, **Integrations** (WhatsApp Cloud API + AI master switch), **WhatsApp templates** (Meta catalog sync), **WhatsApp automation** (event→template), **WhatsApp QR link** (unofficial), users.

### Admin (SUPER_ADMIN)
- **Companies** — tenant management. **Jobs** — job-queue inspection.

### Public / client-facing
- **Client portal** (`/portal/<token>`) — login-free, per-client: shortlist with photos, upcoming appointments, payments, agent contact, **self-serve viewing booking**.
- **Public property page** (`/p/<slug>`) — shareable listing with view telemetry (`PropertyView`) feeding high-intent lead scoring.
- **CNIC verify** (`/verify-identity/<token>`) — mobile camera CNIC capture for contract e-sign.

---

## 5. Key Workflows

### 5.1 Lead → Deal → Cash
1. Lead enters (manual, CSV import, public-page view, or **inbound WhatsApp auto-capture** → classify → find/create client → create lead → auto-route by strategy).
2. Lead is scored + matched to properties; agents work it through stages; showings logged with GPS.
3. Lead converts to a **Deal** (sale/rental). Deal progresses through its status machine; a **closing checklist** must clear required items before CLOSED_WON.
4. **Commission** computed from rules → split into shares → approval.
5. **Payments** scheduled; reminders fire; **invoices/receipts** generated.

### 5.2 Drip Sequences
A lead reaching a sequence's `triggerStage` is enrolled. The job tick runs due enrolments: WhatsApp-template steps send (consent-gated on `marketingOptOut`), agent-task steps create `CalendarEvent`s. Closed leads / opt-outs exit. One active enrolment per (sequence, lead).

### 5.3 CNIC e-Signature Contracts
On a deal, "Start CNIC verification" creates a `Contract` (snapshotting terms), and sends each party (seller/landlord = property owner; buyer/renter = client) a tokenised link over WhatsApp (`/verify-identity/<token>`). The party photographs their CNIC; OCR (`lib/ocr.ts`, ≥0.8 confidence) extracts name + number, stores the image as a verified `Document`, and advances the contract to `PENDING_VERIFICATION` once **both** parties are recorded. Works for **SALE and RENTAL** (`ContractType`).

### 5.4 Document Generation & Editing
"Generate documents" on a deal produces a **printable HTML pack** (tracked as `Document` rows pointing at `/deal-documents/[id]/[doc]`):
- **Sale (9):** Agreement to Sell, Sale Deed (Transfer), Payment Schedule, Token/Booking Receipt, Possession Note, NOC, Seller's Affidavit, Power of Attorney, Tax/FBR Certificate.
- **Rental (5):** Rental Agreement, Security Deposit Receipt, Possession Note, NOC, Tenant Undertaking.

Each auto-fills from the deal + contract (including verified CNIC identities). Operators can **edit the contract terms/parties/clauses**, or **edit any document inline (WYSIWYG)** — click "Edit document", change the rendered text in place, Save (stored as a sanitized HTML override on `Contract.documentOverrides`); "Reset to standard" reverts. Edited docs freeze to their saved text until reset.

### 5.5 WhatsApp (dual-mode)
- **Outbound** routes through a single layer (`lib/wa-send.ts`): a connected **QR session (Baileys)** is preferred, the **Cloud API** is the fallback. Templates render to plain text for the QR path. Covers lead-page sends (queued), drips, contract links, automations.
- **Inbound** from either the Cloud API webhook (`/api/webhooks/whatsapp`, HMAC-validated) or the QR socket is normalized to a common `{from, text, name}` shape and enqueued on the `WHATSAPP_INBOUND` pipeline (classify → lead capture/route → STOP/opt-out).

---

## 6. Database Structure

PostgreSQL via Prisma. **37 models, 40 enums.** Every tenant-owned row has `companyId` with Cascade/SetNull conventions chosen per relationship. Indexing discipline: index real query paths + FK cascade/SetNull paths; avoid speculative cross-tenant indexes.

### Models by domain
- **Tenancy / identity:** `Company`, `User`, `Project`, `Dealer`, `Client`
- **Inventory:** `Property`, `PropertyMedia`, `PropertyAgent`, `PropertyView`
- **Pipeline:** `Lead`, `CalendarEvent`, `Showing`, `GpsLog`
- **Transactions:** `Deal`, `DealAgent`, `DealChecklistItem`, `Sale`, `Rental`, `Contract`
- **Finance:** `Payment`, `Invoice`, `CommissionRule`, `Commission`, `CommissionShare`
- **Documents / audit:** `Document`, `ActivityLog`, `Notification`
- **Automation / messaging:** `DripSequence`, `DripStep`, `DripEnrollment`, `WhatsAppTemplate`, `WhatsAppAutomation`, `WhatsAppSession`, `AiSuggestion`
- **Infrastructure:** `Job`, `IdempotencyKey`, `SweepState`

### Notable enums (40 total)
`Role`, `UserStatus`, `CompanyStatus`, `CompanyPlan`, `BillingStatus`, `PropertyType`, `AreaUnit`, `ListingType`, `PropertyStatus`, `MediaKind`, `LeadStage` (10 ordered stages), `LeadSource`, `LeadScoreOverride`, `ClientType`, `LeadRoutingStrategy`, `CalendarEventType/Status`, `VerificationStatus`, `InterestLevel`, `GpsLogKind`, `DealType`, `DealStatus`, `AgreementStatus`, `ContractStatus`, `ContractType`, `DealAgentRole`, `PaymentType/Status`, `InvoiceStatus`, `CommissionStatus/Party`, `FallbackParty`, `DocumentType`, `NotificationType/Channel`, `JobStatus`, `AiSuggestionType`, `WaAutomationEvent`, `DripStepKind`, `DripEnrollmentStatus`.

> Full field-level definitions live in `prisma/schema.prisma` (authoritative). The blueprint (`docs/PROPTIMIZR_BLUEPRINT.md`) has verbatim field listings for the core objects.

### Migration model
`prisma db push` (no migration history). Index/CHECK changes that need zero-lock or constraints are hand-written SQL under `deploy/migrations/` (e.g. `CREATE INDEX CONCURRENTLY`, money CHECK constraints), applied before the push picks them up as no-ops.

---

## 7. API & Integration Details

### 7.1 API routes (`src/app/api/**`)
| Route | Purpose | Auth |
|---|---|---|
| `/auth/[...nextauth]` | NextAuth (login/session) | — |
| `/signout` | Sign out | session |
| `/upload` | File upload to disk store | session |
| `/files/[...path]` | Serve tenant files | session + tenant check |
| `/export` | Data export | session |
| `/jobs/tick` | Cron entry — drain queue + sweeps + drips | Bearer `JOBS_TICK_TOKEN` (fail-closed) |
| `/webhooks/whatsapp` | Cloud API inbound + status callbacks | HMAC `WHATSAPP_APP_SECRET` |
| `/whatsapp/qr-status` | Poll QR link status (renders QR) | session (OWNER) |
| `/contracts/verify-cnic` | CNIC OCR receiver (token) | unguessable token + rate-limit |
| `/public/portal-booking` | Self-serve viewing booking | portal token |
| `/public/portal-media/[token]/[propertyId]/[mediaId]` | Portal property photos | portal token + shortlist gate |
| `/public/property-media/[slug]/[mediaId]` | Public listing media | share slug |
| `/share/track` | Public-page view telemetry | — |

### 7.2 Integrations
- **WhatsApp — Cloud API** (official): per-tenant `whatsappPhoneId` + encrypted `whatsappAccessToken` + `whatsappBusinessAccountId` (Settings → Integrations). Outbound text/template (`lib/wa-business.ts`), template-catalog sync, inbound webhook. AES-256-GCM token encryption (`lib/crypto.ts`).
- **WhatsApp — QR (unofficial, Baileys):** scan-to-link a normal number (Settings → WhatsApp QR link). One live socket per company in the long-running process; auth creds persisted to a per-company on-disk session dir (auto-reconnects across restarts); status mirrored in `WhatsAppSession`. ⚠️ **Against Meta's ToS — ban risk.**
- **AI provider abstraction** (`lib/ai/provider.ts`): `AI_PROVIDER` override → prefer Anthropic → fallback OpenAI; `aiComplete()` + a cached `runAi` pipeline (caches via `AiSuggestion`, budget-gated). Prod uses OpenAI `gpt-4o-mini`. Powers: inbound classification, lead brief, property copy.
- **OCR** (`lib/ocr.ts`): CNIC extraction for e-sign.
- **Maps:** Leaflet (client-side).
- **File storage:** local disk (`UPLOAD_ROOT`), served via `/api/files` behind auth.

### 7.3 Deployment / Infrastructure
- **Host:** shared VPS; app at `/var/www/RealEstate`, PM2 process `promptzer-crm` (single fork), nginx → `127.0.0.1:3000`, domain `crm.proptimizr.com`.
- **CI/CD:** push to `main` → GitHub Actions (`appleboy/ssh-action`) → `deploy/redeploy.sh`: `git reset --hard`, `npm ci`, `prisma db push`, `npm run build`, `pm2 reload`. ~1.5 min.
- **Cron:** every-minute job tick (see §1.2). logrotate for the tick log.
- **Env:** runtime config in `/var/www/RealEstate/.env` (600). Prod npm 10 / node 22 (lockfile must be npm-10-compatible).

---

## 8. Screenshots

Authenticated screenshots could not be auto-captured for this export (the app requires login). The **`docs/screenshots/` folder contains a capture guide** (`README.md`) listing every screen, its route, and the role needed — so a human or a browser-automation tool can populate it consistently. See that file.

---

## 9. Known Issues

1. **WhatsApp QR is unofficial & ToS-violating** — the linked number can be **banned** by Meta. Provided as an explicit opt-in alongside the supported Cloud API.
2. **QR socket is single-process** — lives in the one PM2 fork; not horizontally scalable, and a crash in the socket shares the web process. Reconnects from disk on restart.
3. **Edited documents freeze** — once a generated document is hand-edited (inline), it no longer auto-syncs with later contract/term changes until "Reset to standard".
4. **No migration history** — `prisma db push` + `--accept-data-loss` on deploy; safe for additive/nullable changes but offers no down-migrations or audited schema diffs.
5. **Local/prod npm version skew** — lockfiles must be generated with npm 10 (prod) or `npm ci` fails on deploy.
6. **Per-process daily-sweep history** is now durable (`SweepState`), but other in-memory singletons (rate limiter, WA sockets) remain process-local.
7. **Demo/seed data on prod** — the prod tenants (Metro Realty, Skyline Estates) are demo data; some generated document packs exist on demo deals.

## 10. Current Limitations

- **No automated test suite** of meaningful coverage (a `test/` dir with node:test exists for a few units); changes are verified by tsc + lint + build + ad-hoc live-DB scripts.
- **Tenant isolation is application-enforced** (no DB row-level security) — relies on every query carrying `companyId`.
- **File storage is local disk** — no S3/blob backend; not multi-node safe.
- **Real-time** is poll/tick-based (1-minute cron), not push (no SSE/WebSocket for notifications).
- **AI** runs a single small model (`gpt-4o-mini`) with a simple cache; no streaming, dynamic model selection, or semantic cache.
- **Search** is Postgres trigram-based, not a dedicated search engine.
- **Secrets management** — tokens are encrypted at rest, but there's no vault/rotation automation; key rotation is manual (re-encrypt helper exists: `scripts/reencrypt-tokens.ts`).
- **Observability** — structured logging/correlation IDs/tracing are roadmap, not implemented.

## 11. Planned Roadmap

Two roadmap docs exist in `docs/`:

- **`docs/OPTIMIZATION_ROADMAP.md`** — engineering hardening, tiered:
  - **Tier 1 (high):** query optimizer (caching/timeout/N+1), metrics N+1 fix, keyset pagination (done in parts), trigram search (done), optimistic locking for Commission/Payment, idempotency keys for financial mutations (done in parts), DB CHECK constraints (done in parts).
  - **Tier 2 (medium):** soft-delete + restore, **real-time notifications (SSE + Postgres LISTEN/NOTIFY)**, materialized analytics views, AI dynamic model selection + streaming + fallback, input-hash semantic cache.
  - **Tier 3 (observability/scale):** correlation IDs + structured logging, OpenTelemetry, ActivityLog partitioning, read-replica for reports, horizontal PM2 + DB-backed rate limiting, S3-compatible blob storage.
  - **Security:** progressive login lockout, typed sensitive-op audit wrapper, same-origin assertion, tenant-isolation assertion guard, session fingerprinting/IP anomaly.

- **`docs/PROPTIMIZR_BLUEPRINT.md`** — the original feature blueprint (note: predates this cycle; treat its "absent/partial" markers as historical — lead routing, drips, document generation, closing checklists, client portal, and WhatsApp QR are now built).

### Open product candidates (not yet built)
- Wire the **QR socket** for production-grade resilience (separate worker, horizontal scale).
- **Predictive close-probability** is built at the deal level (calibrated) — could extend to leads.
- **e-Signature** beyond CNIC capture (true signature capture / audit certificate).
- Outstanding ops: rotate any exposed secrets; optionally clear demo data on prod.

---

## Appendix A — Source-of-truth files
| Concern | File |
|---|---|
| Roles & permissions | `src/lib/rbac.ts` |
| Navigation / modules | `src/lib/nav.ts` |
| Database schema | `prisma/schema.prisma` |
| Auth | `src/auth.ts`, `src/proxy.ts` |
| Jobs / cron | `src/app/api/jobs/tick/route.ts`, `src/lib/jobs/**`, `src/lib/jobs/throttle.ts` |
| WhatsApp Cloud API | `src/lib/wa-business.ts`, `src/lib/wa-automation.ts` |
| WhatsApp QR (Baileys) | `src/lib/wa-qr/manager.ts`, `src/lib/wa-send.ts` |
| AI | `src/lib/ai/**` |
| Documents | `src/lib/deal-documents.ts`, `src/app/deal-documents/[id]/[doc]/page.tsx` |
| Contracts / e-sign | `src/lib/contract-service.ts`, `src/app/api/contracts/verify-cnic/route.ts` |
| Drip sequences | `src/lib/drip.ts` |
| Lead scoring / routing | `src/lib/lead-score.ts`, `src/lib/lead-router.ts` |
| Close-probability / forecast | `src/lib/close-probability.ts`, `src/lib/reports.ts` |
