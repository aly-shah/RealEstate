# SYSTEM EXPORT DOCUMENTATION

**Product**: promptzer Real Estate CRM / ERP (internal codename: *Scalamatic Estate*)
**Public URL**: https://crm.proptimizr.com
**Repository**: github.com/aly-shah/RealEstate (branch `main`)
**Build tag at time of audit**: `e06f980 feat(i18n): use Noto Sans Arabic for Urdu instead of Nastaliq`
**Audit basis**: This document is grounded in the deployed source tree, not behavioral probing of the live site. Every claim is traceable to a file:line in the repo. Items that could not be confirmed in code are explicitly marked **[Inferred]**.

---

## Table of contents
1. Executive overview
2. Tech stack analysis
3. Complete role system
4. Authentication & security
5. Complete dashboard export
6. Property management system
7. Lead management system
8. Agent management system
9. Commission & financial logic
10. Complete user workflows
11. Database structure (canonical)
12. API & backend logic
13. UI / UX analysis
14. Reporting & analytics
15. Automation & AI opportunities
16. Scalability analysis
17. Security & compliance
18. Improvement roadmap
19. Final system summary

---

# SECTION 1 — EXECUTIVE OVERVIEW

## 1.1 What the system is

**promptzer CRM** is a multi-tenant back-office platform that combines a **Customer Relationship Management (CRM)** system and a lightweight **Enterprise Resource Planning (ERP)** system tailored to **real estate agencies and property developers** operating primarily in Pakistan (PKR currency, Karachi-centered geography, bilingual English/Urdu UI, RTL support).

It is **not a public buyer portal** — there is no consumer-facing listing site, no SEO landing pages, no anonymous lead-capture form. Every screen is behind authentication and every record is partitioned by `companyId` so that one deployment can host many independent real-estate businesses.

The product is delivered as a single-binary Next.js 16 application served from a single VPS behind nginx + PM2 + PostgreSQL (see deploy/setup.sh). It is shipped with two demo tenants ("Skyline Estates" and "Metro Realty") and five demo logins — see Section 4.

## 1.2 Who it is built for

| Audience | What they get |
|----------|--------------|
| **Real-estate agency owners** | A single back-office for properties, leads, agents, dealers, deals, commissions, payments and reporting; mobile-friendly for field agents. |
| **Property developers** | A "Projects" container that groups properties from the same off-plan / on-plan development. |
| **Dealers / sub-brokers** | A scoped login that exposes only their own inventory, their deals, their commission shares. |
| **Field agents** | A mobile-first phone shell with GPS check-in, bottom tab bar, today's tasks, active leads and their pending earnings. |
| **The SaaS operator (promptzer)** | A Super-Admin "platform console" at `/admin/companies` to onboard, suspend or activate tenant companies. |

## 1.3 Primary business purpose

To replace WhatsApp groups, spreadsheets, paper agreements and ad-hoc commission calculations with a single source of truth that:

1. Tracks **every property** the business holds, by status (Available → Reserved → Negotiation → Sold/Rented) and by who supplied it (owner inline or dealer).
2. Pushes **every enquiry** through a 10-stage lead pipeline so nothing falls through the cracks.
3. Records **every showing**, with GPS or manual location and client feedback, so owners know what their agents actually did this week.
4. Computes **commission splits automatically** when a deal closes, with role-based approval and per-share payout tracking.
5. Produces **payment receipts**, overdue reports and CSV exports for accounting.

## 1.4 ERP capabilities

The "ERP side" — what makes this more than a CRM — covers:

- **Multi-entity ledger** of payments (TOKEN, BOOKING, DOWN_PAYMENT, INSTALMENT, RENT, DEPOSIT, COMMISSION) with status (PENDING, PARTIAL, PAID, OVERDUE).
- **Invoice** entity (modeled, used by exports/seeders but no UI screen yet — see Roadmap §18).
- **Commission engine** (`src/lib/commission.ts`) that splits across main agent, company, co-agents and dealer with a configurable fallback when there are no co-agents.
- **Approval workflow** with persisted approver, timestamp and notification (`commissions/actions.ts`).
- **Document register** with verification status, expiry tracking and 30-day "expiring soon" badge.
- **Activity log** as an immutable audit trail of every business action (`ActivityLog` model + `logActivity()`).
- **Tenant settings** (currency, locale defaults) stored as JSON on `Company.settings`.

## 1.5 CRM capabilities

- **10-stage pipeline** (NEW → CONTACTED → INTERESTED → SITE_VISIT → PROPERTY_SHOWN → NEGOTIATION → TOKEN_BOOKING → PAYMENT → CLOSED_WON | CLOSED_LOST), enforced as a Prisma enum so reports can group reliably.
- **Lead sources** (REFERRAL, WALK_IN, SOCIAL_MEDIA, PORTAL, CALL, REPEAT_CLIENT, OTHER) for source-attribution reporting.
- **Client preferences** (budget min/max, preferred type, preferred area, free-text requirements) per lead.
- **Lost-reason capture** mandatory whenever stage transitions to CLOSED_LOST — surfaces as a Reports widget.
- **Per-lead activity timeline** (lead-scoped slice of `ActivityLog`).
- **Calendar events linked to leads** for tasks/showings/follow-ups; status transitions to DONE/CANCELLED/MISSED.

## 1.6 Real-estate operational workflows

- **Listing onboarding** with reference auto-numbering (`SKY-0001`, `MET-0001` — derived from `Company.refPrefix` chosen at seed/deploy time; user-onboarded companies fall back to `SKY-####` because of a hardcoded prefix in `properties/actions.ts:41` — see Roadmap).
- **Media gallery** (PHOTO, VIDEO, FLOOR_PLAN, BROCHURE) per property.
- **Status-aware map view** with Leaflet/OpenStreetMap and a colour-coded legend (Available green, Reserved amber, Sold gold, etc.).
- **Showing/visit check-in** with `navigator.geolocation` or manual location text, plus interest level (HIGH/MEDIUM/LOW/NONE) and free-text client feedback.
- **Visit verification workflow** (PENDING → VERIFIED / FLAGGED) gated by office roles.
- **Deal lifecycle** (DRAFT → NEGOTIATION → TOKEN → BOOKED → AGREEMENT → CLOSED_WON|CLOSED_LOST) that, on CLOSED_WON, **also flips the linked property to SOLD or RENTED** (`deals/actions.ts:107`).
- **Print-friendly payment receipts** at `/receipts/[paymentId]` with company branding.

## 1.7 Target users

| Role | Daily user |
|------|-----------|
| Owner | Business owner watching revenue, conversion, leaderboard, pending commission. |
| Admin | Office manager — assigns leads, verifies visits/documents, approves commissions, records payments. |
| Agent | Field salesperson on a phone — gets today's tasks, active leads, records visits, sees earnings. |
| Dealer | Inventory supplier — sees only their listings, only their deals, only their commission share. |
| Super Admin | promptzer ops — provisions/suspends tenant companies. |

## 1.8 Operational scale assumptions [Inferred]

- Page queries `take: 100`–`200` rows. There is **no pagination** UI yet, so the largest table view in production handles "all properties/leads/deals up to the most recent 100/150/200". This is a deliberate MVP shape — single PostgreSQL instance, no Redis, no queue.
- `prisma db push` is used (no migration files committed) — schema iteration is fast but production schema drift must be reapplied via the same path.
- The deploy script's `pm2` config caps memory at `640M` per node process (`deploy/setup.sh:166`) — sized for a small VPS, not a horizontal fleet.

---

# SECTION 2 — TECH STACK ANALYSIS

## 2.1 Inferred from `package.json`, configs and code

| Layer | Choice | Evidence | Reasoning behind choice |
|-------|--------|----------|------------------------|
| **Frontend framework** | **Next.js 16.2.6** (App Router) | `package.json` deps; `src/app/` tree; `AGENTS.md` warns about Next.js 16 breaking changes | Server Components let dashboards do DB queries directly without an API layer — the entire app has only 5 HTTP routes (auth, signout, upload, files, export). |
| **UI runtime** | **React 19.2.4** + **React DOM 19.2.4** | `package.json` | Required by Next.js 16; uses React 19's `useActionState()` hook (e.g. `LoginForm.tsx:24`, every form) for progressive-enhancement forms. |
| **Language** | **TypeScript 5** in `strict` mode | `tsconfig.json` | Compile-time guarantees over a Prisma-typed data layer. Path alias `@/* → src/*`. |
| **Styling** | **Tailwind CSS v4** (via `@tailwindcss/postcss`) | `postcss.config.mjs`, `globals.css` uses `@import "tailwindcss"` + `@theme` block (the v4 syntax) | v4's CSS-first tokens drive a custom design system declared in `globals.css` (`--color-accent: #4f46e5`, gradients, custom `.surface`/`.field`/`.btn-*` components). |
| **Charts** | **Recharts 2.15** | `package.json`; `dashboards/DashboardCharts.tsx`, `reports/ReportCharts.tsx`, `activity/ActivityCharts.tsx` | Pure-React, SSR-friendly, no D3 wrangling. |
| **Maps** | **Leaflet 1.9** + **react-leaflet 5** with **OpenStreetMap** tiles | `MapView.tsx` (dynamic import, SSR-disabled), `LeafletMap.tsx` | No API key, no paid quota. Karachi-centered default (`KARACHI: [24.86, 67.01]`). |
| **ORM** | **Prisma 6.2** generator + `@prisma/client` | `prisma/schema.prisma`; `lib/prisma.ts` (singleton pattern guarded against hot-reload duplication) | Type-safe queries, single source of truth for the 756-line data model, `prisma db push` for schema sync. |
| **Database** | **PostgreSQL** | `prisma/schema.prisma:9-12` (`provider = "postgresql"`) and `deploy/setup.sh` installs `postgresql postgresql-contrib` | Multi-tenant with logical separation (`companyId` column); leverages enums, decimals (`@db.Decimal(14,2)` / `@db.Decimal(5,2)`), JSON columns (`Company.settings`, `ActivityLog.meta`). |
| **Authentication** | **Auth.js v5 (NextAuth 5.0.0-beta.31)** with the **Credentials provider** + **JWT sessions** | `src/auth.ts`; `src/middleware.ts` calls `auth()` to gate every route. | Stateless sessions — no session table — and the credentials provider lets the company onboard users without external IdPs. JWT callback embeds `role` and `companyId` into the token so RBAC checks don't need a DB lookup. |
| **Password hashing** | **bcryptjs** (10 rounds) | `auth.ts:28`, `settings/actions.ts:38`, `admin/companies/actions.ts:42` | Standard, pure-JS, no native build hassle. |
| **Input validation** | **Zod 3.24** | Every server action begins with `const parsed = schema.safeParse(...)` | Same schema produces TS types and runtime checks. |
| **State management** | **None** (React Server Components + URL state) | `FilterBar.tsx` writes filters into the URL via `useRouter().replace()`; pages re-render server-side. | No Redux/Zustand, no React Query. The filter bar's "URL-as-state" pattern (`FilterBar.tsx:30-49`) means filtered views are shareable links. |
| **UI framework** | **Custom design system on top of Tailwind v4** | `globals.css` declares `.surface`, `.surface-soft`, `.field`, `.label`, `.btn-primary/.btn-accent/.btn-ghost`, `.chip`, `.kbd`, `.live-dot` | No 3rd-party component library — full visual control. |
| **Mobile responsiveness** | **Responsive Tailwind + dedicated mobile shell pieces** | `Sidebar.tsx` (collapses on `< lg`), `AgentBottomNav.tsx` (fixed bottom tab bar shown only to `role === "AGENT"`), `globals.css` `--sidebar-w` swap | The agent panel is mobile-first: 5-tab nav (Dashboard, Leads, Visits, Calendar, Notifications), large tap targets, GPS check-in. |
| **File uploads** | **Local filesystem under `uploads/<companyId>/<uuid>.<ext>`**, served back through `/api/files/...` with auth | `lib/uploads.ts`, `api/upload/route.ts`, `api/files/[...path]/route.ts` | Avoids paying for S3 in MVP; the file route enforces tenant isolation by checking the first path segment matches the caller's companyId. |
| **Session management** | **NextAuth JWT** carried in an httpOnly cookie | `auth.ts:13` (`session: { strategy: "jwt" }`) | No session table, but means revocation = waiting for the JWT to expire (default 30d). |
| **Deployment infrastructure** | **Single Ubuntu VPS** with **nginx → PM2 → Next.js standalone → PostgreSQL**, **Let's Encrypt** TLS via certbot | `deploy/setup.sh`, `deploy/redeploy.sh`, `.github/workflows/deploy.yml` (SSH-triggered redeploy on push to `main`) | Idempotent shell script; one PM2 process, max 640 MB; nginx forwards `X-Forwarded-Proto` so Auth.js builds correct HTTPS callback URLs. |
| **Security layers** | (1) Middleware route guard; (2) `requireUser` / `requireCompanyUser` / `requireCapability` server helpers; (3) Zod input validation; (4) Tenant-scoped Prisma queries; (5) RBAC capability map; (6) Upload extension/size allowlist; (7) Path-traversal guard on file serving | `src/middleware.ts`, `lib/session.ts`, `lib/rbac.ts`, `lib/scope.ts`, `lib/uploads.ts`, `api/files/[...path]/route.ts:22` | Defense in depth — even if the middleware were bypassed, server actions individually call `requireCapability()` and queries are wrapped in scope functions. |
| **Real-time systems** | **None** — pages revalidate via `revalidatePath()` after server actions | Every server action ends with `revalidatePath("/some-route")` | No websockets, no SSE, no polling. New notifications appear only on next navigation. |
| **Notification system** | **In-app only** — DB rows in `Notification` rendered at `/notifications`; unread count shown in sidebar/topbar/bottom-nav badges | `lib/activity.ts:notify()`, `app/(app)/notifications/page.tsx`, `(app)/layout.tsx:23` | Per requirements, SMS / WhatsApp / email reminders are Phase-2. |
| **I18n** | **Hand-rolled dictionary** at `lib/i18n/dictionary.ts` (English + Urdu), cookie-keyed (`pz-locale`), server-resolved via `getDict()` | `lib/i18n/server.ts`, `components/i18n/LocaleSwitcher.tsx`; root layout sets `<html lang dir>` from the cookie | Lightweight — no `next-intl` or `i18next` dependency. Urdu set uses `Noto Sans Arabic` (preferred over Nastaliq per the most recent commit) and `[dir="rtl"]` triggers a font swap for body text while keeping Latin glyphs (emails, prices, dates) crisp via `[data-keep-latin]`. |

## 2.2 Why these choices

- **App Router + Server Components** eliminates 80% of the API surface: a "page" reads Prisma directly. The only `/api/*` routes are for things that can't be a server action (NextAuth, multipart uploads, binary file streaming, CSV download).
- **JWT sessions over DB sessions** removes one query per request; the tradeoff is no revocation list.
- **Prisma + Postgres** is the standard "boring choice" for a 20-model multi-tenant app and gives free CSV exports via `findMany` + the in-house `toCsv` helper.
- **No CDN, no S3, no Redis** keeps Phase-1 ops cost near zero — see Roadmap §18 for when to swap.

---

# SECTION 3 — COMPLETE ROLE SYSTEM

The system has **exactly 5 roles**, defined as a Prisma enum (`schema.prisma:16-22`) and labeled in `lib/rbac.ts:31-37`.

```
SUPER_ADMIN | OWNER | ADMIN | AGENT | DEALER
```

The capability matrix is in `src/lib/rbac.ts:8-20`. Reproduced verbatim:

| Capability | Who can do it |
|------------|---------------|
| `manageCompanies` | SUPER_ADMIN |
| `manageUsers` | SUPER_ADMIN, OWNER, ADMIN |
| `manageProperties` | SUPER_ADMIN, OWNER, ADMIN, **AGENT**, **DEALER** |
| `assignLeadsCalendars` | SUPER_ADMIN, OWNER, ADMIN |
| `updateLeadsVisits` | SUPER_ADMIN, OWNER, ADMIN, AGENT |
| `recordDeals` | SUPER_ADMIN, OWNER, ADMIN |
| `setCommissionRules` | SUPER_ADMIN, **OWNER only** (Admins cannot change the default split) |
| `approveCommission` | SUPER_ADMIN, OWNER, ADMIN |
| `viewCompanyReports` | SUPER_ADMIN, OWNER, ADMIN |
| `managePayments` | SUPER_ADMIN, OWNER, ADMIN |
| `manageDocuments` | SUPER_ADMIN, OWNER, ADMIN, AGENT, DEALER |

Row-level scoping is enforced in `src/lib/scope.ts`:
- **Agents** see only properties where they are on `PropertyAgent`, only leads where `agentId = self`, only deals where they appear in `DealAgent`.
- **Dealers** see only properties / deals where `dealerId = own dealer row`.
- **Office roles (Owner/Admin)** see the whole company.

## 3.1 SUPER_ADMIN — Platform operator

**Dashboard access**: After login, redirected directly to `/admin/companies` (`lib/rbac.ts:40-43`).
**Permissions**: Every capability (implicitly via being listed in every capability list).
**Data visibility**: All tenants (the only role with `companyId = null`).
**Allowed actions**:
- Onboard a new company + its first OWNER user with a temp password (`admin/companies/actions.ts:createCompany`). Each new company gets a default commission rule "Company Default 50 / 25 / 25" with the platform's standard 50/25/25 split.
- Toggle a company's status between ACTIVE and SUSPENDED (`admin/companies/actions.ts:setCompanyStatus`).
- Read any file from any tenant via `/api/files/...` (the only role bypassed by the cross-tenant check, `api/files/[...path]/route.ts:25-28`).
**Restrictions**: Cannot enter tenant-scoped screens — `requireCompanyUser()` will bounce them back to `/admin/companies` since their `companyId` is null.
**Workflow involvement**: Provisioning only. Daily operations happen inside tenant accounts.

## 3.2 OWNER — Business owner

**Dashboard access**: `/dashboard` → `OwnerDashboard` (KPIs, revenue trend, lead pipeline, leaderboard).
**Permissions**: Every capability except `manageCompanies`. **The only role that can edit the default commission split rule.**
**Data visibility**: Everything inside their `companyId`.
**Allowed actions**:
- Approve commissions (`commissions/actions.ts:approveCommission`).
- Mark individual commission shares as paid (`commissions/actions.ts:markSharePaid`).
- Configure default commission percentages (`settings/actions.ts:updateCommissionRule`).
- Add/remove team members (`settings/actions.ts:createUser`) — choosing role from {ADMIN, AGENT, DEALER}.
- Everything an Admin can do.
**Workflow involvement**: Strategic + approval. Sees all dashboards, all reports, all earnings.

## 3.3 ADMIN — Daily operations

**Dashboard access**: `/dashboard` → `AdminDashboard` (action-oriented: leads to assign, visits to verify, docs to check, payments due, today's schedule, commissions awaiting approval).
**Permissions**: Same as Owner **minus `setCommissionRules`**. Can still approve commissions, just not change the underlying %.
**Data visibility**: Whole company.
**Allowed actions**: Assign leads to agents, verify/flag showings, verify/reject documents, record payments, mark payments paid, generate commissions on closed deals, approve commissions, manage users (add admins/agents/dealers).
**Restrictions**: Cannot change the default commission split (must ask the Owner).
**Workflow involvement**: The "operations manager" — the queue-clearing role. The Admin dashboard explicitly surfaces "What needs attention today".

## 3.4 AGENT — Field salesperson

**Dashboard access**: `/dashboard` → `AgentDashboard` (greeting, today's tasks, active leads, properties assigned, commission pending/earned).
**Mobile shell**: Bottom tab bar with Dashboard / Leads / Visits / Calendar / Notifications (`shell/AgentBottomNav.tsx`).
**Permissions**: `manageProperties`, `updateLeadsVisits`, `manageDocuments`.
**Data visibility**: Strictly scoped:
- Properties: only those with a `PropertyAgent` row pointing at them.
- Leads: only `agentId = self`.
- Deals: only those with a `DealAgent` row pointing at them.
- Calendar: only events where `agentId = self`.
- Visits: only their own showings.
**Allowed actions**:
- Add a new property — and on creation **auto-assign themselves** (`properties/actions.ts:76`).
- Capture a new lead (auto-assigned to themselves).
- Advance the stage of their own leads (refused otherwise: `leads/actions.ts:99`).
- Record a showing with GPS or manual location, interest level and client feedback (`visits/actions.ts:recordShowing`).
- Mark calendar tasks DONE.
- Upload documents.
**Restrictions**: Cannot assign leads, cannot record deals, cannot record payments, cannot approve commissions, cannot see other agents' work.
**Workflow involvement**: The execution layer. Their performance feeds the agent leaderboard, conversion rate, "active days (30d)" and visit verification rate on their profile (`agents/[id]/page.tsx`).

## 3.5 DEALER — Inventory supplier

**Dashboard access**: `/dashboard` → `DealerDashboard` (their inventory count, deals closed, share earned, share pending; if no `Dealer` row is linked to their user yet, a hint asks them to contact an admin).
**Permissions**: `manageProperties`, `manageDocuments`.
**Data visibility**:
- Properties: only those where `dealerId = own dealer row id`.
- Deals: only those linked to their dealer row.
- Commissions: only commissions that have a share with `dealerId = own`.
- Documents: only documents linked to their dealer row.
**Allowed actions**: Add properties (will be linked to them as supplier inline by an admin), upload documents.
**Restrictions**: Cannot see leads (no `/leads` nav item), cannot record deals, cannot record payments, cannot see other dealers.
**Workflow involvement**: Inventory contribution + visibility into their own earnings. Acts as a transparent "show me my deals" portal.

## 3.6 Role-routing matrix

```
After login:
  SUPER_ADMIN → /admin/companies
  OWNER/ADMIN/AGENT/DEALER → /dashboard
                                ├── role === OWNER  → OwnerDashboard
                                ├── role === ADMIN  → AdminDashboard
                                ├── role === AGENT  → AgentDashboard
                                └── role === DEALER → DealerDashboard
```

(Defined in `lib/rbac.ts:homePathForRole` + `app/(app)/dashboard/page.tsx`.)

---

# SECTION 4 — AUTHENTICATION & SECURITY

## 4.1 Login flow

1. User browses `/login`.
2. Server renders `LoginForm.tsx` with localized strings + 5 one-click demo accounts that prefill `password = "password"`.
3. Form posts via React 19's `useActionState` to `loginAction` (`src/app/login/actions.ts`), which calls `signIn("credentials", { email, password, redirectTo: "/dashboard" })`.
4. `auth.ts:authorize` runs: Zod-validates the input, looks up the user by lowercased email, **rejects if `status === "SUSPENDED"`**, bcrypt-compares the password, returns `{ id, email, name, role, companyId }`.
5. NextAuth callbacks copy `id, role, companyId` from the user into the JWT and onto `session.user` so RBAC checks need no DB hop (`auth.ts:42-56`, types declared in `src/types/next-auth.d.ts`).
6. The browser receives an httpOnly `next-auth.session-token` cookie. Middleware (`src/middleware.ts`) thereafter redirects unauthenticated requests to `/login?from=...`, and pushes logged-in users away from `/login` to `/dashboard`.
7. The root page `/` (`src/app/page.tsx`) reads the session and redirects to the role-specific home.

## 4.2 Session behavior

- `session.strategy = "jwt"` (`auth.ts:13`). No DB session table. Default lifetime is 30 days (NextAuth default — not overridden).
- Session is decoded server-side on every protected page through `auth()`. The middleware matcher excludes `api/auth`, `_next/static`, `_next/image`, `favicon.ico` and files with extensions (`middleware.ts:24-27`).
- Sign-out posts to `/api/signout` (`api/signout/route.ts`), which calls `signOut({ redirectTo: "/login" })`.

## 4.3 Access control

Three layered helpers in `lib/session.ts`:

- `requireUser()` — any authenticated user; redirects to `/login` if not.
- `requireCompanyUser()` — same plus must have a `companyId`. Super Admins bounced to `/admin/companies`.
- `requireCapability(cap)` — same plus `can(role, cap)` from the RBAC matrix; otherwise redirect to `/dashboard`.

Plus query-level helpers in `lib/scope.ts`:
- `propertyScope(user)` / `leadScope(user)` / `dealScope(user)` return Prisma `where` fragments that limit results to what the role may see.

The crucial defense-in-depth pattern is that **every server action re-checks `requireCompanyUser()` + `can()`** — the menu hiding the link is not the guarantee. E.g. `properties/actions.ts:45-46`, `deals/actions.ts:36-37`, `commissions/actions.ts:11`, `settings/actions.ts:24`, `admin/companies/actions.ts:19-22`.

## 4.4 Route protection

| Route | Public? | Auth required? | Capability? |
|-------|---------|----------------|-------------|
| `/login` | yes | — | — |
| `/api/auth/*` | yes | — | — (NextAuth itself) |
| All other routes | no | yes (middleware) | varies per page via `requireCapability()` or `can()` |

The matcher `["/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\..*).*)"]` (`middleware.ts:26`) means: gate everything except NextAuth, Next.js internals, the favicon, and anything with a file extension (e.g. `/file.svg`).

## 4.5 Password handling

- bcryptjs at cost 10 in three places: `auth.ts:28` (compare), `settings/actions.ts:38` (new tenant user), `admin/companies/actions.ts:42` (new owner during company onboarding).
- Passwords are **plain text in the new-user form by design** (`settings/SettingsForms.tsx:50` uses `type="text"`) — this is a *deliberate temporary-password handoff* pattern: the admin sets a visible temp password to share with the new user.
- No password reset flow, no forgotten-password email, no password-policy enforcement (Zod only requires `min(6)`).
- No 2FA, no SSO, no SAML, no OAuth.

## 4.6 Security assumptions

- Trusts the proxy chain (`AUTH_TRUST_HOST=true` in deploy script).
- Cookies are httpOnly + secure once nginx adds `X-Forwarded-Proto=https`.
- Cross-tenant access at the file API is explicitly blocked unless the caller is `SUPER_ADMIN` (`api/files/[...path]/route.ts:25-28`).
- The upload endpoint validates extension (allowlist in `lib/uploads.ts:ALLOWED_EXT`) and size (`MAX_UPLOAD_BYTES = 10MB`) — and stores files under `uploads/<companyId>/<uuid>.<ext>` so the original filename never lands on disk.
- The file API rejects any path containing `..` or extra `/` segments and verifies that the resolved path is still within `UPLOAD_ROOT/<companyId>` (`api/files/[...path]/route.ts:22, 31`).

## 4.7 Multi-user management

- Owners and Admins create users in `/settings`. The form constrains role to {ADMIN, AGENT, DEALER} — you cannot create an OWNER from inside a tenant (Owners exist only via Super Admin onboarding).
- Creating a DEALER user also creates a `Dealer` profile linked to them so inventory can be assigned (`settings/actions.ts:45-49`).
- User status (ACTIVE/SUSPENDED/INVITED) is in the schema but the only UI today shows status; suspension/reactivation has no button (see Roadmap §18).

## 4.8 Permission inheritance

There is no role inheritance — every role's capabilities are explicit in the matrix. SUPER_ADMIN is special-cased only by being listed in every capability and getting a different home page; otherwise it follows the same checks.

## 4.9 Potential vulnerabilities

| Concern | Where | Severity | Notes |
|---------|-------|----------|-------|
| Password column visible in DB if dump leaks | `User.passwordHash` (bcrypt'd, fine) | Low | Bcrypt cost 10 — acceptable for now. |
| Temp passwords sent in plaintext form fields | `SettingsForms.tsx:50` (`type="text"`) | Low | Deliberate, but flag for compliance reviews. |
| No rate limiting on `/login` or `/api/upload` | absent | **Medium** | A bot can brute-force; an authed user can spam 10 MB uploads. Add nginx `limit_req_zone` or middleware. |
| JWT cannot be revoked before expiry | NextAuth JWT mode | Medium | Suspending a user lets their old token live until expiry. Mitigate via short JWT TTL + a token-version check OR switch to DB sessions. |
| Session cookie is not pinned to IP/UA | NextAuth default | Low | Standard; OK behind TLS. |
| Receipts at `/receipts/[id]` are protected by `requireUser()` + `companyId === user.companyId` (`receipts/[id]/page.tsx:13-22`) | OK | — | Tenant-scoped — good. |
| `/api/files` allows guessable UUIDv4 paths but every fetch is auth-checked | OK | — | Even with a leaked path you must be in that company. |
| CSRF on `/api/signout` and `/api/upload` | not explicit | Low | NextAuth CSRF handles `signIn`; signout is a same-origin POST + uses no body. Server actions are CSRF-protected by Next.js's built-in token. Direct API POSTs (`/api/upload`) are credentialed-only and check session, but lack a CSRF token — fine for same-site, but if a third party embeds an upload form, the user's cookie would be sent. **Recommendation**: set `SameSite=Lax` (default) or `Strict` on the session cookie, plus an Origin header check on `/api/upload`. |

## 4.10 Recommended improvements

1. **Short JWT TTL + sliding renewal** (e.g. 1h access + 30d refresh) or **switch to DB sessions** for revocable suspensions.
2. **Rate limiting** on `/login` (5/min/IP), `/api/upload` (20/min/user).
3. **Account lockout** after N failed logins.
4. **Password complexity policy** + **forced rotation on first login** for temp passwords created in `/settings`.
5. **Audit log enrichment**: include the actor IP and user-agent in `ActivityLog.meta` (currently the field exists and is unused).
6. **2FA** (TOTP) for OWNER + SUPER_ADMIN at minimum.
7. **Forgot-password flow** with email-based token.

---

# SECTION 5 — COMPLETE DASHBOARD EXPORT

There are **4 role-aware dashboards** + **1 platform console**. All sit under `src/components/dashboards/` and are picked by `app/(app)/dashboard/page.tsx`.

## 5.1 Owner dashboard (`OwnerDashboard.tsx`)

**Purpose**: Strategic, business-health view.

**Layout** (top-to-bottom):
1. **PageHeader** — eyebrow `Owner dashboard`, title `How the business is doing`, subtitle.
2. **KPI strip** (4 `StatCard`s):
   - Revenue this month (with **▲/▼ % vs last month delta** computed from the 6-month trend, `OwnerDashboard.tsx:42-52`).
   - Commission pending (with "paid" subline).
   - Open deals (count of `Deal.status NOT IN [CLOSED_WON, CLOSED_LOST]`).
   - Overdue payments (sum of overdue + count outstanding).
3. **Charts row** (2/3 + 1/3):
   - **Revenue trend** — `RevenueTrendChart`, a 6-month area chart with gradient fill, total + peak month callouts; the data comes from `monthlyRevenue()` in `lib/metrics.ts` which buckets `Sale.salePrice` by `Deal.closeDate.month`.
   - **Inventory mix** — `InventoryDonut`, a 7-slice pie of `Property.status` counts with centre label = total, legend on the right.
4. **Funnel + leaderboard row** (3/5 + 2/5):
   - **Lead pipeline** — `LeadsFunnelChart`, horizontal bar per stage with intensity-graded fill; `CLOSED_WON` slice is solid green.
   - **Agent leaderboard** — top 5 of `agentLeaderboard()` with rank chip (gold for #1), avatar initials, deals won, conversion %, revenue. Hover-lifts.

**KPI widgets**: All `StatCard` instances accept `{label, value, sub, tone, icon}` (`ui/StatCard.tsx`); the top hairline marker animates on hover.

**Filters**: None — the dashboard is fixed-scope (this month + 6-month trend).

**Quick actions**: Section headers carry `View all →`, `Reports →`, `Calendar →` links into the deep screens.

**Operational use**: Daily glance — "Are we up or down vs last month? Who's pulling weight? What's about to close? What money have we earned but not paid out?"

## 5.2 Admin dashboard (`AdminDashboard.tsx`)

**Purpose**: Operational, action-oriented — "What needs me today?"

**Layout**:
1. PageHeader (eyebrow `Admin dashboard`, title `What needs attention today`).
2. **KPI strip** (4 StatCards):
   - Leads to assign (`agentId IS NULL` and not closed).
   - Visits to verify (`Showing.verification = PENDING`).
   - Docs to check (`Document.verification = PENDING`).
   - Payments due (count of `PENDING | PARTIAL | OVERDUE` from `outstandingPayments()`).
3. **Today's schedule** — calendar events between start-of-day and end-of-day, sorted by `startAt`, max 8. Each shows agent + property + event type badge.
4. **Commissions awaiting approval** — list of commissions with status `PENDING_APPROVAL`, click `Review →` jumps to `/commissions/[id]`.

**Operational use**: An office manager opens this every morning; everything on it is a queue waiting for action.

## 5.3 Agent dashboard (`AgentDashboard.tsx`)

**Purpose**: Personal performance + today's plan, mobile-optimized.

**Layout**:
1. **Hero greeting card** — gradient brand banner with time-of-day greeting ("Good morning") and "Bilal — let's make today count."
2. **KPI strip** (4 StatCards):
   - Today's tasks (their calendar events for today).
   - Active leads (assigned to them, not closed).
   - Properties (their `PropertyAgent` count).
   - Commission pending (with "earned" subline) — from their own `CommissionShare` rows.
3. **Today's calendar** — only their events.
4. **Your active leads** — top 6 of their leads, ordered by `updatedAt`.

**Mobile shell**: This is the only role that gets the `AgentBottomNav` fixed at the bottom of the viewport on `< lg`.

**Operational use**: A field agent opens it on their phone, sees today's appointments and which leads to nudge.

## 5.4 Dealer dashboard (`DealerDashboard.tsx`)

**Purpose**: Visibility into their own inventory and earnings.

**Layout**:
1. PageHeader with dealer name + area of operation.
2. **KPI strip** (4 StatCards):
   - Inventory count (with `available` sub).
   - Deals closed (CLOSED_WON only).
   - Share earned (paid shares).
   - Share pending (unpaid shares).
3. **Your inventory** — list of their properties with status badges.
4. **Deals through your inventory** — list of CLOSED_WON deals with deep-link.

**Edge case**: If a DEALER user has no `Dealer` row yet (e.g. provisioned but not linked), the dashboard renders an inert empty state asking them to contact admin (`DealerDashboard.tsx:28-35`).

## 5.5 Super Admin console (`/admin/companies/page.tsx`)

**Purpose**: Platform-wide control.

**Layout**:
1. PageHeader (eyebrow `Platform console`, title `Companies`).
2. **KPI strip** (3): Companies / Active / Total users.
3. **Onboard a new company** form (`CompanyForm.tsx`) — inputs: companyName, ownerName, ownerEmail, ownerPassword (plain `type="text"` for the same temp-password handoff reason). On success: creates Company + first Owner + default 50/25/25 CommissionRule transactionally.
4. **All companies** table: Company, Plan, Users, Properties, Deals, Created, Status + Suspend/Activate button (toggles `Company.status`).

## 5.6 Common shell elements (visible on every dashboard)

- **Sidebar** (`shell/Sidebar.tsx`) — grouped nav (Workspace / Sales / Field / Finance / People / Insights / System), per-role item set from `lib/nav.ts`, active-state with brand gradient bar, collapsible (`localStorage.pz-sidebar-collapsed`), notifications unread badge, sign-out at the bottom.
- **Topbar** (`shell/Topbar.tsx`) — sticky glass header with **Global Search ⌘K**, Locale switcher (EN ⇄ UR), Notifications bell with badge, User menu (initials avatar + dropdown). Hidden on `< lg`; mobile uses the sidebar drawer.
- **Global search** (`shell/GlobalSearch.tsx`) — full-screen modal triggered by `⌘K` / `Ctrl+K`, lists `Search for "x"` action + recent searches (`localStorage.pz-recent-searches`, max 5) + 5 quick links (Dashboard, Properties, Leads, Deals, Reports). Routes to `/search?q=...`.
- **Agent bottom nav** (`shell/AgentBottomNav.tsx`) — phone-only, role === AGENT only, 5 tabs: Dashboard, Leads, Visits, Calendar, Notifications.

## 5.7 Information hierarchy across dashboards

Every dashboard follows the same vertical rhythm: PageHeader → KPI strip (always 2×4 grid on `lg`) → 2–3 section cards. Sections use `ui/Section.tsx` which renders a titled panel with a small uppercase header, optional `action` slot (typically a `View all →` link) and content area. This gives the product a consistent enterprise feel — one of its main UX strengths.

---

# SECTION 6 — PROPERTY MANAGEMENT SYSTEM

## 6.1 Property creation flow

`/properties/new` is gated by `manageProperties` (so all roles except SUPER_ADMIN can create).

Form (`PropertyForm.tsx`):
- **Basics**: title (required), type (APARTMENT/VILLA/RESIDENTIAL/COMMERCIAL/PLOT/SHOP/OFFICE), purpose (SALE/RENT/BOTH), status (defaults AVAILABLE), dealer dropdown — **only visible to OWNER/ADMIN** (`PropertyForm.tsx:53`), description.
- **Location & pricing**: city, area, address, salePrice, monthlyRent, deposit (all optional numbers).
- **Layout & owner**: bedrooms, bathrooms, coveredArea, ownerName, ownerPhone.

On submit, `createProperty` (`properties/actions.ts`):
1. Re-checks `manageProperties` capability.
2. Zod-parses the FormData with field-level error returns.
3. Allocates a reference `SKY-####` from `prisma.property.count({ where: { companyId } }) + 1` (`properties/actions.ts:39-42`).
4. Inserts the property + (if creator is an AGENT) **auto-attaches them as `PropertyAgent`** so they immediately see the listing.
5. Writes an `ActivityLog` entry with action `property.created` and a human summary `Added property SKY-0001 — 4-Bed Sea-Facing Apartment in Clifton`.
6. `revalidatePath("/properties")` and `redirect("/properties/[id]")`.

## 6.2 Property categories (enums)

```
PropertyType:   RESIDENTIAL | COMMERCIAL | PLOT | APARTMENT | VILLA | SHOP | OFFICE
ListingType:    SALE | RENT | BOTH
PropertyStatus: AVAILABLE | RESERVED | UNDER_NEGOTIATION | RENTED | SOLD | INACTIVE | PENDING_VERIFICATION
```

## 6.3 Sale vs rental properties

- **Both prices live on the same `Property` record** — `salePrice` and `monthlyRent` are independent nullable Decimals (`schema.prisma:344-347`). A `BOTH` listing has both; a `RENT` listing leaves `salePrice` null.
- The list view smartly renders `${sale} · ${rent}/mo` if both are present (`properties/page.tsx:84-89`).
- The Map filter excludes properties without `latitude/longitude` so map markers map cleanly.

## 6.4 Property statuses + transitions

A right-rail `StatusChanger` (visible only when `manageProperties` capability holds) is a single `<select>` + Update button that posts `updatePropertyStatus` — server action that finds the property within the tenant, updates the status, writes an `ActivityLog` (`property.status`), revalidates the detail page and the list.

**Automatic transitions**:
- `Deal.status` → `CLOSED_WON` flips the linked property to **SOLD** (sale deal) or **RENTED** (rental deal) (`deals/actions.ts:107-112`).
- The `PENDING_VERIFICATION` initial-status case is supported but rarely used (the form defaults to AVAILABLE).

There are no other forced transitions — the rest are manual.

## 6.5 Availability logic

- Static booleans don't exist; "available" is derived as `status === "AVAILABLE"`.
- The Lead-create dropdown only shows properties with status in `["AVAILABLE", "UNDER_NEGOTIATION", "RESERVED"]` so you don't get to attach a lead to a sold unit (`leads/new/page.tsx:14-19`).
- `availableFrom` and `rentedUntil` are Date fields on the property — exposed on the detail page; no calendar logic enforces them today.

## 6.6 Image / media management

`PropertyMedia` model: id, propertyId, kind (PHOTO/VIDEO/FLOOR_PLAN/BROCHURE), url, caption. `PropertyGallery.tsx` renders a 3-col grid:
- Image URLs (regex `\.(jpe?g|png|webp|gif|avif)$`) → `<img>` thumbnail with `object-cover`.
- Other URLs → a "click to open" tile with the kind label.

Upload path: `Uploader.tsx` POSTs the file to `/api/upload`, gets back `{url, name}`, then `addPropertyMedia` server-action writes the row. `deletePropertyMedia` removes the row (file remains on disk — orphaned).

Activity log on every media add: `property.media_added` action.

## 6.7 Property ownership / supplier model

Two modes (mutually exclusive at semantic level — schema allows both, UI shows one):
1. **Inline private owner** — `Property.ownerName` + `Property.ownerPhone` text fields.
2. **Dealer-supplied** — `Property.dealerId → Dealer.id` (link visible in the right-rail "People" card).

This dual model is the whole point of the Dealer role — when a deal closes on dealer-supplied inventory, the dealer takes a commission share (see Section 9).

## 6.8 Agent assignment

- Many-to-many via `PropertyAgent (propertyId, agentId, assignedAt)` (`schema.prisma:395-404`).
- Agents auto-self-assign on create (above).
- Office roles can re-assign — but **there is no UI today to add/remove agents from a property after creation**. The screen shows the list but no editor (`/properties/[id]/page.tsx:156-169`). See Roadmap §18.

## 6.9 Listing workflows (full lifecycle)

```
Created (PENDING_VERIFICATION or AVAILABLE)
   └─ Media uploaded (kind = PHOTO|VIDEO|FLOOR_PLAN|BROCHURE)
   └─ Documents linked (ownership docs, photos of CNIC of owner, etc.)
   └─ Lead attached (optional, via lead.propertyId)
   └─ Showing recorded (Showing rows, GPS or manual)
   └─ Status → UNDER_NEGOTIATION
   └─ Status → RESERVED
   └─ Deal created (DRAFT)
        └─ Deal status → TOKEN → BOOKED → AGREEMENT → CLOSED_WON
             → Property auto-flips to SOLD or RENTED
        └─ Commission generated → approved → shares paid
```

## 6.10 Search & filter

List page (`/properties/page.tsx`):
- URL-state filters: `q` (title/reference/area/city, case-insensitive contains), `status`, `type`.
- Sort: `createdAt desc`, top 100 rows.
- The `FilterBar` writes the chosen values to the query string so the view is shareable.

Cross-entity Search (`/search?q=...`):
- Searches Properties (title, reference, area, city), Leads (client.name), Deals (reference, property.title) for everyone; Clients + Dealers for OFFICE roles only.
- Always tenant-scoped, role-scoped (`lib/search.ts`).

## 6.11 Property lifecycle states (Mermaid summary)

```
PENDING_VERIFICATION ──┐
AVAILABLE              ├─→ UNDER_NEGOTIATION ─→ RESERVED ──┐
                       │                                    ↓
                       └────────────────────────────→  Deal CLOSED_WON
                                                            ↓
                                                  SOLD or RENTED
INACTIVE (admin-controlled archive)
```

---

# SECTION 7 — LEAD MANAGEMENT SYSTEM

## 7.1 Lead creation

`/leads/new` (capability `updateLeadsVisits` — i.e. office + agents). Inputs:
- Client: name (required), phone, email.
- Enquiry: source (REFERRAL/WALK_IN/SOCIAL_MEDIA/PORTAL/CALL/REPEAT_CLIENT/OTHER), agent picker **only for office** (agents are forced to assign to themselves), interested property (optional), budgetMin/budgetMax, prefArea, requirements (free text).

On submit `createLead`:
1. Creates a fresh `Client` row (no de-dup against existing clients — see Roadmap §18).
2. Creates a `Lead` linked to that client + (optionally) a property + an agent.
3. Writes `lead.created` ActivityLog.
4. If the lead got assigned to someone other than the creator, fires a `LEAD_ASSIGNED` Notification.

## 7.2 Lead sources

The `LeadSource` enum tags origin. Reports widget groups by `source` for attribution.

## 7.3 Inquiry workflow

The 10 stages, in canonical order (`lib/metrics.ts:leadsByStage`):

```
NEW → CONTACTED → INTERESTED → SITE_VISIT → PROPERTY_SHOWN →
NEGOTIATION → TOKEN_BOOKING → PAYMENT → CLOSED_WON
                                       ↘  CLOSED_LOST (any time)
```

Pipeline summary tiles at the top of `/leads` show counts per stage (groupBy query) and click-through to a filtered list.

## 7.4 Assignment system

- Office roles can re-assign via `AssignControl.tsx` (a `<select agentId>` + Assign button, capability `assignLeadsCalendars`).
- Re-assignment fires a Notification to the new agent + writes `lead.assign` to ActivityLog.

## 7.5 Follow-up tracking

- Calendar events of type `FOLLOW_UP` linked to the lead via `CalendarEvent.leadId`.
- Lead detail page shows up to 10 most-recent events.
- No automated SLA/timer ("48h since stage change" etc.) — manual.

## 7.6 Status pipeline + conversion

The stage control on the lead detail page (`StageControl.tsx`):
- Office roles can move any lead.
- Agents can move only their own (server-action enforced: `leads/actions.ts:99`).
- Moving to `CLOSED_LOST` reveals a required-by-UX `lostReason` text field which is persisted to `Lead.lostReason` and shown on the reports page's "Lost-lead reasons" widget.

`conversion %` per agent = `wonLeads / totalLeads * 100` (`lib/metrics.ts:agentLeaderboard`).

## 7.7 Lead scoring

Not implemented. The schema has nothing equivalent. **[Inferred]** the closest thing is the per-showing `interestLevel` (HIGH/MEDIUM/LOW/NONE) which is a manual signal but not aggregated into a lead score. See Roadmap §18.

## 7.8 Activity tracking

- `ActivityLog` rows with `entityType = "LEAD", entityId = leadId` are surfaced as a Timeline on the lead detail page.
- Visit-side activity tracks property showings via separate `Showing` rows.

## 7.9 Call tracking

Not implemented. **[Inferred]** the `LeadSource` enum has `CALL` and the `Client.phone` is captured, but there is no integration with telephony / no call-log entity. Adding `Communication { id, leadId, kind: CALL|WHATSAPP|EMAIL, direction, body, at }` would slot cleanly into the model.

## 7.10 WhatsApp / contact integration possibilities

None today (acknowledged Phase-2 in README). The system has a phone field per Client; building a "WhatsApp this lead" action that prefills `wa.me/<phone>?text=...` would be a 10-line change with no backend dependencies. A real WhatsApp Business API integration would need a queue + the `Notification` model extended with `channel` and `external_id`.

## 7.11 CRM automation opportunities

- Auto-create a `FOLLOW_UP` calendar event 48h after a stage transition to NEW/CONTACTED.
- Auto-notify the assigned agent when a lead has been in INTERESTED for >7 days without a showing.
- Auto-suggest properties matching the lead's `budgetMin/Max + prefType + prefArea` (the data is all there; today `/leads/new` only lets you pick from the global list).
- Round-robin or load-balanced lead assignment for new walk-in / portal leads.

## 7.12 Full lead lifecycle (end-to-end)

```
1. Walk-in / call / referral captured by agent or admin     → Client + Lead (NEW, agentId)
2. Notification to assigned agent                            (if office-assigned)
3. Agent calls client                                        → manually moves to CONTACTED
4. Agent records interest                                    → INTERESTED (+ optional propertyId)
5. Calendar event scheduled                                  → SITE_VISIT / SHOWING event
6. Showing recorded with GPS, feedback, interest level       → Showing row + ActivityLog
7. Admin verifies the showing                                → Showing.verification = VERIFIED
8. Negotiation begins                                        → Lead → NEGOTIATION
9. Token money paid                                          → Lead → TOKEN_BOOKING + Payment(type=TOKEN)
10. Booking + down payment                                   → Lead → PAYMENT
11. Deal created from this lead (via Deal.leadId)            → Deal in DRAFT/NEGOTIATION
12. Deal closes                                              → Lead → CLOSED_WON, Property → SOLD/RENTED
13. Commission generated + approved + shares paid            → CommissionShare.paid
14. (Or at any point: Lead → CLOSED_LOST + lostReason)
```

---

# SECTION 8 — AGENT MANAGEMENT SYSTEM

## 8.1 Agent onboarding

Admin/Owner adds an agent in `/settings → Add a team member` form:
- name, email, **plain-text temp password** (≥ 6 chars), phone, role = AGENT (default).
- Bcrypt-hashes the password and writes the user row.
- Logs `user.created`.

No invitation email, no first-login forced reset (Roadmap §18).

## 8.2 Performance tracking

Computed in `lib/metrics.ts:agentLeaderboard`:
- `dealsWon` = count of MAIN-role deal links with `Deal.status = CLOSED_WON`.
- `revenue` = sum of `Sale.salePrice + Rental.monthlyRent` across those deals.
- `leads` = count of all assigned leads (any stage).
- `conversion` = `CLOSED_WON leads / total leads * 100`.

The leaderboard is sorted by `revenue desc, dealsWon desc` and powers:
- `/agents` page (full ranked table with conversion progress bars).
- Owner dashboard's "Agent leaderboard" widget (top 5 with gold #1 chip).

## 8.3 Sales analytics per agent

The Agent profile page `/agents/[id]` (`agents/[id]/page.tsx`) is the most KPI-dense screen in the app. It computes:

**Workload card** (4 KPIs):
- Assigned properties (PropertyAgent count).
- Properties shown (distinct `Showing.propertyId`).
- Clients handled (distinct client IDs across leads + showings).
- Active leads (`total - won - lost`).

**Results card** (4 KPIs):
- Leads converted (+ conversion %).
- Sales closed.
- Rentals closed.
- Revenue generated.

**Earnings & field card** (4 KPIs):
- Commission earned (paid CommissionShare amounts).
- Commission pending (unpaid).
- Visits verified (`Showing.verification = VERIFIED`).
- Active days (last 30): distinct days with checked-in showings OR completed events.

Plus an **Activity calendar** (custom month grid in `agent/ActivityCalendar.tsx`) showing visits + events per day, click a day to see its agenda.

Plus side-panels: Field visits & client feedback, Lost deals & reasons, Recent leads, Assigned properties, Performance bar, **Admin remarks (private)** — a textarea visible only to OWNER/ADMIN (`Section title="Admin remarks (private)"` is gated on `office` flag).

## 8.4 Leaderboard

See 8.2. The `/agents` page is gated by `viewCompanyReports` so agents themselves can't see the ranking.

## 8.5 Commission tracking

Per-agent earned + pending pulled directly from `CommissionShare` rows where `userId = agent.id`. Aggregated on the Agent dashboard ("Commission pending: {compactMoney(pending)} · {compactMoney(earned)} earned") and on the agent profile page.

## 8.6 Property assignment

Many-to-many via `PropertyAgent`. Auto on self-create; manual reassign is not yet implemented in UI.

## 8.7 Activity logging

Every server action writes to `ActivityLog`. The agent profile shows a Timeline of their own actions (filtered to `userId = agent.id`). The full company-wide log lives at `/activity`.

## 8.8 Agent KPIs

Already covered (Workload / Results / Earnings & field). Notable absent KPIs: avg response time, calls made, WhatsApp messages, sales target attainment %.

## 8.9 Attendance / availability assumptions

- "Active days" is a proxy for attendance: distinct days in the last 30 where the agent either checked into a showing or completed a calendar event.
- There is no clock-in/clock-out, no scheduled-off-days, no PTO.

## 8.10 Communication systems

- In-app notifications only (`Notification` model rendered at `/notifications`).
- `notify()` helper writes a row when a lead is assigned, a commission needs approval, a calendar task is assigned, a commission is approved (`commissions/actions.ts:31-38`).

## 8.11 Internal operational flow (Admin → Agent)

1. Admin assigns a lead → notification.
2. Agent calls/visits → records a showing.
3. Admin verifies the showing → status flips to VERIFIED.
4. Agent advances stage → activity log.
5. Admin records the deal → agent is on `DealAgent` with MAIN role.
6. Deal closes → admin generates commission → agent earns a share.
7. Owner/Admin approves → notification to agent.
8. Office marks share paid → agent's "earned" goes up.

---

# SECTION 9 — COMMISSION & FINANCIAL LOGIC

## 9.1 Commission structures

A `CommissionRule` (per-company default + optional per-property override) holds **four percentages and a fallback flag**:

```
mainAgentPct   default 50%
companyPct     default 25%
otherAgentPct  default 25%   (the pool split equally among co-agents)
dealerPct      default  0%
noOtherFallback: "MAIN" | "COMPANY"  (where the co-agent slice goes if there are no co-agents)
```

The four percentages **must total 100** — enforced in `settings/actions.ts:80-81` before update.

## 9.2 The split algorithm (`lib/commission.ts:computeCommission`)

Given `(rule, ctx={total, mainAgent, otherAgents[], dealer})`:

1. Start with `mainPct, companyPct, otherPctTotal, dealerPct` from the rule.
2. **If no co-agents**: re-home `otherPctTotal` to either MAIN or COMPANY per the fallback.
3. **If no dealer**: the entire `dealerPct` rolls into the company.
4. Build a `shares[]` list:
   - `AGENT_MAIN` share at the (possibly inflated) main %.
   - `COMPANY` share at the (possibly inflated) company %.
   - For each co-agent, an equal slice of `otherPctTotal / co-agents.length` as `AGENT_OTHER`.
   - If dealer present + non-zero, a `DEALER` share.
5. **Rounding drift**: amounts are `Math.round(n*100)/100`. Any drift between `sum(shares) and total` is absorbed by the first share so totals reconcile (`commission.ts:103-104`).

## 9.3 Payment flows (Payment model)

Payment types (`PaymentType` enum): TOKEN, BOOKING, DOWN_PAYMENT, INSTALMENT, RENT, DEPOSIT, COMMISSION.
Payment statuses: PENDING, PARTIAL, PAID, OVERDUE.

Operations:
- `recordPayment` (`payments/actions.ts`): writes a payment optionally linked to a Deal; if status PAID, sets `paidAt = now`.
- `markPaymentPaid`: flips status to PAID + `paidAt = now`.
- Status is recomputed live in the UI: a payment with `dueDate < now` and not `PAID` shows the "Overdue" badge regardless of stored status (`payments/page.tsx:48`).

## 9.4 Revenue distribution

The `Commission` (totalAmount, status) + its child `CommissionShare` rows are the source of truth. A deal's revenue (Sale.salePrice or Rental.monthlyRent) is **not** the commission — the commission is a separately-entered amount on which the split runs.

## 9.5 Agent payouts

Per share:
- `paid: Boolean`, `paidAt: DateTime?`.
- `markSharePaid` (`commissions/actions.ts:52-83`) flips one share to paid; if all shares of the commission are paid, the parent `Commission.status` is bumped to `PAID`.

There is no actual money movement — the system records the decision; integration with a payment gateway / payroll is Phase-2.

## 9.6 Company earnings

`commissionTotals(companyId)` (`lib/metrics.ts:24-37`) sums every `CommissionShare.amount` across all commissions, split into paid vs pending. Surfaced as KPI strip on `/commissions` and on the Owner dashboard.

## 9.7 Deal profitability

The deal detail page shows:
- The headline value (sale price OR monthly rent).
- "Collected so far" = sum of PAID payments.
- Commission total + each share with its paid/unpaid badge.

Per-deal profitability (commission ÷ sale price) is **not** computed today but trivially derivable.

## 9.8 Financial dashboards

- Owner dashboard: Revenue this month, Commission pending, Open deals, Overdue payments.
- Reports page: Revenue trend, Outstanding (with overdue breakdown), Commission summary.

## 9.9 Transaction tracking

All money rows carry `companyId` + `dealId` (nullable for misc) + `receiptNo`, `method`, `dueDate`, `paidAt`, `notes`. Activity log captures `payment.recorded` and `payment.paid`.

## 9.10 Accounting assumptions

- Single currency (PKR), formatted via `Intl.NumberFormat("en-PK", "currency", "PKR")` and an Urdu variant (`<number> روپے`).
- No multi-currency, no FX, no general-ledger journals.
- No tax fields (GST/sales tax), no escrow accounts.
- The `Invoice` model exists (`schema.prisma:620-635`) but **no UI route or server action references it today**. It's modeled and waiting.

## 9.11 Invoice / payment possibilities

Schema is ready for: invoice issuance per deal, link payment to invoice, generate PDF (mechanism already proven by the receipt page).

## 9.12 Inferred formulas

- **Per-share amount** = `round((total × pct) / 100, 2)` with drift absorbed by the first share.
- **Commission generation suggestion** in `DealDetailPage`: `suggestedComm = Math.round(value * 0.02)` — i.e. the UI pre-fills 2% of the deal value as a starting point (`/deals/[id]/page.tsx:47`).
- **Estimated split preview** in the deal-create wizard: lets the user dial a `commRate` (default 2%, step 0.5%) and re-runs `computeCommission` client-side for visual feedback (`DealForm.tsx:42-56, 187-204`).

---

# SECTION 10 — COMPLETE USER WORKFLOWS

Every workflow below is a verified step-by-step trace through real code.

## 10.1 Workflow A: New lead arrives

1. Admin clicks **+ New lead** on `/leads` → `/leads/new`.
2. Selects source `WALK_IN`, fills client name + phone, picks an interested property from a list of statuses-in-play.
3. (Office only) Picks an agent to assign.
4. Submit → `createLead` server action:
   - Verifies capability `updateLeadsVisits`.
   - Validates with Zod.
   - Creates a fresh `Client` row.
   - Creates the `Lead` row.
   - If assigned to someone other than the actor, writes a `Notification` with `type=LEAD_ASSIGNED, link=/leads/[id]`.
   - Writes `ActivityLog: lead.created`.
   - Revalidates `/leads`, redirects to `/leads/[id]`.

## 10.2 Workflow B: Agent assignment

1. Admin opens `/leads/[id]` → "Assigned agent" panel.
2. `<AssignControl>` lists all AGENT users in the company; admin picks one + clicks Assign.
3. `assignAgent` server action:
   - Verifies capability `assignLeadsCalendars`.
   - Updates `Lead.agentId`.
   - Writes `Notification` to the new agent.
   - Writes `ActivityLog: lead.assign`.
   - Revalidates `/leads/[id]`.

## 10.3 Workflow C: Property showing (field visit)

1. Agent on phone opens `/visits` → taps "⚑ Record a visit".
2. Selects property (from their list), optionally a client.
3. Taps "📍 Use GPS" → browser `navigator.geolocation.getCurrentPosition` populates hidden `lat,lng` inputs (capability check: GPS, not server).
4. Sets interest level + writes client feedback + notes.
5. Submit → `recordShowing` server action:
   - Creates `Showing` row with `checkInAt = checkOutAt = now`.
   - If GPS captured, also writes a `GpsLog { kind: "IN", lat, lng }` (the schema supports IN/OUT logs but the UI currently sends only IN).
   - Writes `ActivityLog: showing.recorded` with `meta: { showingId }`.
6. Admin opens `/visits` later, sees the showing with PENDING badge, taps "✓ Verify" or "⚐ Flag" (`VerifyButtons.tsx`) → `verifyShowing` flips `Showing.verification` to VERIFIED or FLAGGED.

## 10.4 Workflow D: Deal negotiation

1. Office user clicks **+ New deal** → `/deals/new` (4-step wizard).
2. **Step 1 — Deal**: pick SALE/RENTAL, property, optional client, optional dealer.
3. **Step 2 — Money**: enter sale price (or monthly rent + deposit + lease months).
4. **Step 3 — Agents**: pick MAIN agent, tick CO-AGENTs.
5. **Step 4 — Review**: see the **live commission split preview** computed client-side via the same `computeCommission()` the server uses; dial estimated rate %.
6. Submit → `createDeal`:
   - Allocates a `DEAL-####` reference.
   - Creates the Deal in DRAFT.
   - Creates `Sale` or `Rental` child row with the amount.
   - Creates `DealAgent` rows (MAIN + CO_AGENTs).
   - Writes `ActivityLog: deal.created`.
   - Redirects to `/deals/[id]`.

## 10.5 Workflow E: Deal closing

1. Office opens `/deals/[id]` → "Deal status" → sets `CLOSED_WON` + Update.
2. `setDealStatus`:
   - Updates `Deal.status = CLOSED_WON, closeDate = now`.
   - **Flips the linked property to SOLD or RENTED** depending on `Deal.type`.
   - Writes `ActivityLog: deal.status`.
3. The "Commission" panel now shows `<GenerateCommissionForm>` with `suggested = round(value * 0.02)`.
4. Office enters the total commission, clicks **Calculate split** → `generateCommission`:
   - Loads the property's commissionRule (or falls back to the company default).
   - Calls `computeCommission(rule, { total, mainAgent, otherAgents, dealer })`.
   - Creates a `Commission { totalAmount, status: PENDING_APPROVAL }` + child `CommissionShare` rows from the computed shares.
   - Notifies every OWNER/ADMIN in the company with a `COMMISSION_APPROVAL` notification linking to `/commissions`.
   - Writes `ActivityLog: commission.generated`.

## 10.6 Workflow F: Rental agreement

A rental deal follows the same flow but the wizard captures `monthlyRent`, `deposit`, `leaseMonths`. On close, the property flips to RENTED. The `Rental` child carries `renewalDate` (date math driven by seed; UI doesn't yet auto-set this when leaseMonths is supplied — small gap).

## 10.7 Workflow G: Payment collection

Two entry points:

**Inline on deal page** (`/deals/[id]`): `<RecordPaymentForm>` lets office record a payment scoped to the deal. Defaults: type = INSTALMENT (or RENT if rental), status = PAID.

**Standalone on `/payments`**: dropdown picker chooses a deal (or none for misc), type, amount, status, due date, receipt no.

On record:
- `recordPayment` writes the row, with `paidAt = now` if status is PAID.
- Activity log: `payment.recorded`.
- Page revalidations include both `/payments` and `/deals/[id]`.

Marking later: every non-PAID row shows a "Mark paid" button → `markPaymentPaid` → `paidAt = now`, status PAID, activity log `payment.paid`.

Receipt: every PAID payment exposes a `/receipts/[id]` link that renders a print-friendly receipt (company branding + parties + line item + total + Print/Save-as-PDF button via `PrintButton`).

## 10.8 Workflow H: Commission payout

1. Owner/Admin opens `/commissions` → sees pending-approval rows.
2. Clicks into `/commissions/[id]` → reviews the shares.
3. Clicks **Approve commission** → `approveCommission`:
   - Sets `status = APPROVED, approvedById = user.id, approvedAt = now`.
   - Notifies each agent whose userId is on a share.
   - Activity log: `commission.approved`.
4. As money goes out, office clicks **Mark paid** on each share → `markSharePaid`:
   - Sets `paid = true, paidAt = now`.
   - If no unpaid shares remain, bumps the `Commission.status` to PAID.
   - Activity log: `commission.share_paid`.

## 10.9 Workflow I: Property onboarding

Already detailed in §6.1. Short form: create → auto-reference → (agent) auto-assign self → activity log → media upload → documents → ready for leads.

## 10.10 Workflow J: Admin approval flow

The recurring approval queue is **commissions only** (the "approve" capability). Visit verification is closer to a moderation queue. Document verification is identical:
- Doc uploaded with `verification: PENDING`.
- Office sees it on `/documents`, clicks ✓ or ✕ → `verifyDocument`:
  - Sets `verification = VERIFIED|REJECTED, verifiedById = user.id`.

There is no rejection-with-comment workflow.

---

# SECTION 11 — DATABASE STRUCTURE (CANONICAL)

This section is **not inferred** — it's an annotated extract of `prisma/schema.prisma` (756 lines). All Decimal fields are `@db.Decimal(precision, scale)`.

## 11.1 Tenancy & identity

### `Company`
| Column | Type | Notes |
|--------|------|-------|
| id | String @id @default(cuid) | |
| name | String | |
| plan | String @default("standard") | "growth", "standard" — informational only today. |
| status | enum CompanyStatus | ACTIVE / SUSPENDED / TRIAL |
| settings | Json? | currency, locale, defaults |
| createdAt, updatedAt | DateTime | |

Relations to: users, properties, projects, dealers, clients, leads, calendarEvents, showings, deals, payments, invoices, commissions, commissionRules, documents, activityLogs, notifications.

### `User`
| Column | Type | Notes |
|--------|------|-------|
| id | cuid | |
| companyId | String? | NULL for SUPER_ADMIN |
| email | String @unique | (tenant-agnostic uniqueness) |
| passwordHash | String | bcrypt cost 10 |
| name | String | |
| phone | String? | |
| role | enum Role | SUPER_ADMIN / OWNER / ADMIN / AGENT / DEALER |
| status | enum UserStatus | ACTIVE / SUSPENDED / INVITED |
| avatarUrl | String? | (no UI to upload yet) |
| remark | String? | private admin note about the agent |
| createdAt, updatedAt | | |

Indexes: `companyId`, `role`. Relations cover everything the user does.

## 11.2 Inventory

### `Project`
Logical container for off-plan / on-plan developments. Columns: companyId, name, description, city, area, isOffPlan. Has many Properties.

### `Dealer`
| Column | Notes |
|--------|-------|
| companyId | tenant |
| userId | optional — links a Dealer record to a User login |
| name, contact, companyName, areaOfOperation | |
| status | UserStatus enum |
| defaultSharePct | Decimal(5,2) — informational default share for deals from their inventory |
| notes | |

Relations: properties[], deals[], documents[].

### `Property`
~50 columns; the canonical real-estate listing.

| Group | Columns |
|-------|---------|
| Identity | id (cuid), companyId, reference (unique within company), title, description |
| Classification | type (PropertyType), listingType (SALE/RENT/BOTH), status (PropertyStatus, default PENDING_VERIFICATION) |
| Containment | projectId? |
| Supplier | dealerId? OR (ownerName + ownerPhone inline) |
| Location | city, area, address, latitude, longitude, landmarks |
| Pricing | salePrice, monthlyRent, deposit (Decimal(14,2)), negotiable (Bool) |
| Size & layout | coveredArea (Float), plotSize, areaUnit (default "sqft"), bedrooms, bathrooms, floors, parking, yearBuilt |
| Availability | availableFrom, rentedUntil |
| Commission | commissionRuleId? (per-property override) |
| Timestamps | createdAt, updatedAt |

Indexes: `companyId`, `status`, unique on `(companyId, reference)`. Relations: media, agents (M:N), leads, showings, deals, documents, events.

### `PropertyMedia`
propertyId, kind (PHOTO/VIDEO/FLOOR_PLAN/BROCHURE), url, caption, createdAt.

### `PropertyAgent` (join)
Composite PK `(propertyId, agentId)`. Plus `assignedAt`. The mechanism that scopes an agent's property visibility.

## 11.3 CRM

### `Client`
companyId, name, phone, email, address, notes. Has many leads, showings, deals, invoices, documents.

### `Lead`
| Column | Notes |
|--------|-------|
| companyId | |
| clientId? | |
| agentId? | the assigned agent |
| propertyId? | optional interested property |
| stage | LeadStage enum (10 values) default NEW |
| source | LeadSource enum default OTHER |
| budgetMin, budgetMax | Decimal(14,2) |
| prefType | PropertyType? |
| prefArea, prefSize, requirements, notes | |
| lostReason | populated when stage = CLOSED_LOST |
| createdAt, updatedAt | |

Indexes: `companyId`, `agentId`, `stage`. Relations: events, deals.

### `CalendarEvent`
companyId, agentId?, leadId?, propertyId?, type (CalendarEventType: SHOWING/MEETING/FOLLOW_UP/OPEN_HOUSE/PAYMENT_REMINDER/DOCUMENT_REMINDER/RENTAL_RENEWAL/DEAL_CLOSING), status (SCHEDULED/DONE/CANCELLED/MISSED), title, notes, startAt, endAt?, createdAt.

Indexes: `companyId`, `agentId`, `startAt`.

### `Showing`
companyId, agentId, clientId?, propertyId, scheduledAt?, checkInAt?, checkOutAt?, checkInLat/Lng?, manualLocation, notes, clientFeedback, interestLevel (HIGH/MEDIUM/LOW/NONE), photos String[], verification (PENDING/VERIFIED/REJECTED/FLAGGED), createdAt. Has GpsLog[].

### `GpsLog`
showingId, kind ("IN"|"OUT"), latitude, longitude, capturedAt.

## 11.4 Deals & money

### `Deal`
| Column | Notes |
|--------|-------|
| companyId | |
| reference | unique within company; auto `DEAL-####` |
| type | DealType: SALE / RENTAL |
| status | DealStatus: DRAFT/NEGOTIATION/TOKEN/BOOKED/AGREEMENT/CLOSED_WON/CLOSED_LOST |
| agreement | AgreementStatus: NONE/DRAFT/SIGNED/COMPLETED |
| propertyId, clientId?, dealerId?, leadId? | |
| closeDate? | populated on CLOSED_WON |
| createdAt, updatedAt | |

Indexes: `companyId`, `status`, unique `(companyId, reference)`. Relations: DealAgent[], Sale?, Rental?, Payment[], Invoice[], Commission?, Document[].

### `DealAgent` (join)
Composite PK `(dealId, agentId)`, plus `role: MAIN | CO_AGENT`.

### `Sale`
1:1 with Deal. salePrice, tokenAmount, bookingAmount, downPayment, instalmentPlan (string description).

### `Rental`
1:1 with Deal. monthlyRent, deposit, rentalCommission, leaseMonths, renewalDate.

### `Payment`
companyId, dealId?, type (PaymentType), amount, status (PaymentStatus), method, receiptNo, dueDate, paidAt, notes. Indexes: `companyId`, `status`.

### `Invoice`
companyId, dealId?, clientId?, number, amount, status (InvoiceStatus), issuedAt, dueDate. **No UI today** — modeled, ready.

### `CommissionRule`
companyId, name, isDefault, mainAgentPct, companyPct, otherAgentPct, dealerPct (Decimal(5,2)), noOtherFallback ("MAIN"|"COMPANY"), createdAt. Relation: properties (per-property override).

### `Commission`
companyId, dealId @unique, totalAmount, status (DRAFT/PENDING_APPROVAL/APPROVED/PAID), approvedById?, approvedAt?, createdAt. Has CommissionShare[].

### `CommissionShare`
commissionId, party (AGENT_MAIN/COMPANY/AGENT_OTHER/DEALER), userId?, dealerId?, label, pct (5,2), amount (14,2), paid, paidAt?.

## 11.5 Documents & system

### `Document`
| Column | Notes |
|--------|-------|
| companyId | |
| type | DocumentType (9 values) |
| name, url, version (Int @default 1) | |
| verification | PENDING/VERIFIED/REJECTED/FLAGGED |
| verifiedById?, expiryDate?, uploadedById? | |
| Polymorphic links | propertyId?, clientId?, dealerId?, dealId? (use the one that fits) |
| createdAt | |

### `ActivityLog`
companyId, userId?, action (string like `lead.stage`), entityType (string), entityId?, summary (string), meta (Json?), createdAt. Indexes: `companyId`, `(entityType, entityId)`. **The audit spine**.

### `Notification`
companyId, userId, type (NotificationType: REMINDER/PAYMENT_DUE/PAYMENT_OVERDUE/COMMISSION_APPROVAL/VISIT_VERIFY/DOCUMENT_EXPIRY/LEAD_ASSIGNED/GENERAL), title, body?, link?, read (Bool), createdAt. Index: `(userId, read)`.

## 11.6 Cascade behaviour

Every tenant-owned record sets `onDelete: Cascade` to `Company` (`schema.prisma:218,224,279,294,317,409,431,466,489,532,602,623,640,659,696,729,747`). Deleting a Company therefore wipes the tenant clean. `PropertyMedia`, `PropertyAgent`, `DealAgent`, `GpsLog`, `Notification`, `CommissionShare` cascade from their parents.

## 11.7 Scaling concerns / suggested indexes

The schema already has the obvious indexes (`companyId`, status enums, `startAt`, `(userId, read)`). Likely **next-step indexes** for scale:
- `Lead(companyId, stage, updatedAt)` — funnel + recency.
- `Payment(companyId, status, dueDate)` — overdue scan.
- `Showing(companyId, checkInAt)` — agent "active days".
- `Commission(companyId, status)` — approval queue.
- `Deal(companyId, status, closeDate)` — revenue trend.
- Full-text/`pg_trgm` on `Property.title`, `Client.name` for the global search (today's `contains` does sequential ILIKE scans).

---

# SECTION 12 — API & BACKEND LOGIC

## 12.1 The whole HTTP surface

Only **5 HTTP routes**:

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/auth/[...nextauth]` | GET/POST | (NextAuth handlers) | sign-in callback, CSRF token, providers, session endpoint |
| `/api/signout` | POST | session cookie | calls `signOut({ redirectTo: "/login" })` |
| `/api/upload` | POST | session cookie | multipart file → returns `{url, name}` |
| `/api/files/[...path]` | GET | session cookie + tenant check | streams the stored upload back |
| `/api/export?type=...` | GET | `viewCompanyReports` capability | CSV download of agents/deals/payments/properties/leads/commissions |

Every other interaction is a **Next.js Server Action** (function annotated `"use server"`). There are no `/api/properties`, `/api/leads` etc. CRUD endpoints — instead each module has an `actions.ts` file with discrete server functions called by `<form action={action}>`.

## 12.2 Server actions inventory (functional API)

| Module | Action | What it does |
|--------|--------|-------------|
| properties | createProperty | new listing, auto-ref, auto-self-assign for agents, activity log |
| properties | addPropertyMedia | gallery item |
| properties | deletePropertyMedia | remove gallery item |
| properties | updatePropertyStatus | status change + log |
| leads | createLead | new lead + client + assignment notification |
| leads | advanceStage | with required lostReason for CLOSED_LOST |
| leads | assignAgent | re-assign + notify + log |
| deals | createDeal | wizard submission |
| deals | setDealStatus | + auto-flip property to SOLD/RENTED on CLOSED_WON |
| deals | generateCommission | runs `computeCommission` and writes Commission + Shares + notifies approvers |
| commissions | approveCommission | sets APPROVED + notifies share-holders |
| commissions | markSharePaid | marks share paid; closes commission if all paid |
| calendar | createEvent | + notification if assigned to other |
| calendar | setEventStatus | mark DONE/CANCELLED/MISSED |
| visits | recordShowing | with optional GPS log |
| visits | verifyShowing | VERIFY / FLAG |
| payments | recordPayment | with auto paidAt for PAID |
| payments | markPaymentPaid | flip to PAID + activity log |
| documents | uploadDocument | metadata + URL |
| documents | verifyDocument | VERIFY / REJECT |
| agents | updateAgentRemark | private admin note |
| settings | createUser | also creates Dealer profile if role=DEALER |
| settings | updateCommissionRule | with 100%-sum check |
| admin/companies | createCompany | tenant + first OWNER + default rule, all in one tx |
| admin/companies | setCompanyStatus | suspend/activate |
| notifications | markRead | one |
| notifications | markAllRead | all |
| login | loginAction | wraps `signIn` with friendly error |

## 12.3 Common patterns

- Every action begins with `requireUser()` or `requireCompanyUser()` or `requireCapability()`.
- Every input is Zod-validated; the action returns `{ error, fieldErrors }` or `{ ok }` to feed `useActionState`.
- Every mutation calls `revalidatePath(...)` on the affected routes so RSCs re-fetch.
- Most mutations call `logActivity(...)` and, where appropriate, `notify(...)`.

## 12.4 Middleware (`src/middleware.ts`)

A single `auth((req) => ...)` callback gates every request:
- Redirects unauthenticated users to `/login?from=<path>`.
- Redirects already-logged-in users away from `/login` to `/dashboard`.
- Matcher excludes `/api/auth`, Next.js internals, favicon, anything with a file extension.

## 12.5 Authentication middleware (NextAuth)

- Credentials provider only.
- JWT callback embeds `id, role, companyId` (saves a DB hop per request).
- Session callback exposes them on `session.user` (types in `src/types/next-auth.d.ts`).
- Sign-in route page is `/login`.

## 12.6 File upload API

`POST /api/upload` (`api/upload/route.ts`):
1. Require session with `companyId`.
2. Read `file` from multipart form.
3. Reject if > 10 MB or extension not in allowlist (`.jpg,.jpeg,.png,.webp,.gif,.avif,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt`).
4. Sanitize filename via `safeName()` (replaces non-alnum with `_`, caps at 80 chars).
5. `mkdir -p uploads/<companyId>/`, write `<uuid>.<ext>`.
6. Return `{ url: "/api/files/<companyId>/<uuid>.<ext>", name: <original> }`.

## 12.7 File serving API

`GET /api/files/[...path]` (`api/files/[...path]/route.ts`):
1. Require session.
2. Parse `[companyId, ...rest] = segments`.
3. Reject if traversal / cross-company access (Super Admin exempt).
4. Resolve absolute path; ensure it stays inside `UPLOAD_ROOT/<companyId>`.
5. Read + stream with the right Content-Type, `Cache-Control: private, max-age=3600`.

## 12.8 Notification API

There is no notification API — all notifications are written from server actions via `lib/activity.ts:notify(...)`. The UI page `/notifications` lists rows from `Notification` and mutates with `markRead`/`markAllRead` server actions.

## 12.9 Reporting / export API

`GET /api/export?type=agents|deals|payments|properties|leads|commissions`:
- Auth: session + `viewCompanyReports`.
- Builds the CSV via `lib/csv.ts:toCsv` (proper quoting) and `csvResponse()` (correct Content-Disposition).
- Six switch cases each shape a different findMany.

## 12.10 Example endpoint shapes (representative, not exhaustive)

```
POST /api/upload                         (multipart "file" → {url, name})
GET  /api/files/<companyId>/<uuid>.<ext> (binary)
GET  /api/export?type=deals              (text/csv)
POST /api/signout                        (no body → redirect)
GET|POST /api/auth/*                     (NextAuth)
```

Plus **server-action endpoints** (Next.js routes them under `/_next/...` automatically; you only ever see them as `<form action={fn}>`):
- POST createLead, advanceStage, assignAgent
- POST createDeal, setDealStatus, generateCommission
- POST approveCommission, markSharePaid
- POST createProperty, addPropertyMedia, updatePropertyStatus, deletePropertyMedia
- POST createEvent, setEventStatus
- POST recordShowing, verifyShowing
- POST recordPayment, markPaymentPaid
- POST uploadDocument, verifyDocument
- POST createUser, updateCommissionRule
- POST createCompany, setCompanyStatus
- POST markRead, markAllRead, updateAgentRemark, loginAction

---

# SECTION 13 — UI / UX ANALYSIS

## 13.1 Navigation architecture

Two shells:

1. **Office shell**: persistent left **Sidebar** (grouped: Workspace · Sales · Field · Finance · People · Insights · System) + sticky glass **Topbar** (search ⌘K + locale + notifications + user menu).
2. **Mobile / agent shell**: collapsible Sidebar replaced by a top-bar hamburger; **AgentBottomNav** fixed at the bottom for `role === AGENT` only.

Navigation labels are translated via `lib/i18n/dictionary.ts` for both languages.

## 13.2 Responsiveness

- Sidebar fixed at `lg:` breakpoint; under that it collapses to a top app-bar with a menu button.
- Cards scale: `grid-cols-2 lg:grid-cols-4` is the default for KPI strips.
- The Agent dashboard's hero banner stays full-bleed on phones.
- The map page sets `height: "70vh"` so the map fills the viewport on phones.
- The receipt page has explicit print rules (`.print:hidden`, `print:p-0`, etc.) so saving as PDF gives a clean A4 layout.

## 13.3 Information hierarchy

Consistent: PageHeader (eyebrow + title + subtitle + action) → KPI strip → 1–3 Sections. Every panel is a `Section` with a small uppercase header and an optional right-aligned action link. Tables share one component (`ui/Table.tsx`) so column styles, row hover and zebra spacing are uniform.

## 13.4 User experience quality

Notable nice-to-haves:
- **Animation discipline**: a single `pz-fade-up` keyframe used on page headers + menu pops. No motion bloat.
- **Status tone discipline**: Badge tones map enum values to one of 6 quiet tones; warning yellow only on transitional states (NEGOTIATION, TOKEN_BOOKING, PAYMENT); CLOSED_WON gets green; LOST gets red.
- **Empty states** are first-class (`EmptyState.tsx`) — every list has one with a one-line hint.
- **Live commission preview** in the deal wizard is a delightful trust-building UI choice — the user sees the split before they commit.
- **Locale switch is non-blocking**: clicking flips the DOM (lang, dir) instantly and `router.refresh()` revalidates without a hard reload.
- **⌘K global search** with recent searches.

## 13.5 Workflow optimization

- **One-click demo accounts** on `/login` lowers onboarding friction during demos.
- **Filter-bar in URL** means salespeople can bookmark "show me all overdue rent payments".
- **Inline payment & commission forms** on `/deals/[id]` keep office staff on one page during deal close.

## 13.6 Friction points (UX gaps)

- **No pagination** anywhere; large tenants will hit 100-row ceilings.
- **No bulk actions** (mass-assign leads, mass-mark paid).
- **No keyboard shortcuts** beyond ⌘K.
- **No saved views / saved filters**.
- **No undo** — once you mark a payment paid, the only way back is to ask an admin to delete & recreate (and even that path is missing — there is no UI to delete a payment).
- **No re-assignment UI for property agents** after creation.
- **Client de-duplication** doesn't exist — every new lead creates a new Client row (the form has no "search existing client" step).
- **No file rename** after upload; downloaded files keep the UUID basename.
- **The PageHeader action button is a single slot** — pages with multiple actions (Export + Add) stack awkwardly.

## 13.7 Design consistency

- Every color comes from `:root` CSS variables (`globals.css`) or the `COLORS` JS export (`lib/theme.ts`); chart palettes use the same hex values.
- Radius scale: 12 px (chips), 16 px (panels via `.surface`), 24 px (hero gradient cards).
- Typography: Inter for Latin, Noto Sans Arabic for `[dir="rtl"]`; Latin glyphs inside RTL get re-flipped to Inter via `[data-keep-latin]` for emails / dates / prices.

## 13.8 Enterprise usability

The shell is on-par with mid-market SaaS (Pipedrive / HubSpot vibe). What it's missing for true enterprise feel:
- Tabbed sub-navigation inside heavy pages (e.g. Agent profile has 8 sections — would benefit from sticky-tabs).
- Density toggle (compact / cozy / comfortable).
- Column show/hide on tables.
- Multi-select on tables.

## 13.9 Mobile behaviour

Already strong for agents (see 13.2, AgentBottomNav). Office roles on phones get the slide-in sidebar drawer but the dense KPI grids and reports tables are less than ideal on small screens. **[Inferred]** the team optimized mobile primarily for agent use; admins are expected to be on laptops.

## 13.10 Suggested improvements

1. Pagination + page-size selector on all tables.
2. Bulk actions (checkboxes + toolbar).
3. Saved views ("My overdue this month").
4. Tabs on heavy detail pages (Agent profile, Property detail, Deal detail).
5. A consistent "Add" floating button on mobile.
6. Toast notifications for "Saved", "Marked paid", instead of inline `state.ok` lines.
7. Skeleton loaders for slow charts.
8. Client picker that searches existing clients during lead creation.

---

# SECTION 14 — REPORTING & ANALYTICS

The `/reports` page (`app/(app)/reports/page.tsx`) is gated by `viewCompanyReports` (OWNER/ADMIN/SUPER_ADMIN). It is the most query-heavy screen in the app.

## 14.1 Sales reports

- **Revenue this month** vs all-time (`salesRevenue(companyId, since?)`): sums `Sale.salePrice` from CLOSED_WON sale deals with optional `closeDate >= since` filter.
- **Sales / Rentals this month** count (`Deal.count` filtered by type + status + closeDate).
- **Revenue trend · last 6 months** (`RevenueTrend` area chart): per-month rollup of `Sale.salePrice + Rental.monthlyRent` from CLOSED_WON deals.

## 14.2 Rental reports

The Rental child carries `renewalDate` and `leaseMonths`; the schema supports a "RENTAL_RENEWAL" calendar event type. There's no dedicated rentals report screen but the revenue trend folds `monthlyRent` into the total. **[Inferred]** a dedicated rentals page would need adding (e.g. occupancy by month).

## 14.3 Agent reports

- **Leaderboard** with revenue + deals won + leads + conversion %.
- **Agent profile KPIs** (8 KPIs across Workload + Results + Earnings & field cards).
- **Most active people (last 30 days)** on the activity log page — counts of ActivityLog rows per user.

## 14.4 Revenue reports

Covered by Sales reports.

## 14.5 Lead conversion analytics

- **Lead funnel** (`LeadFunnel` horizontal bar chart) — counts per stage, intensity-graded fill, CLOSED_WON in solid ink black/green.
- **Lead conversion KPI** on the reports page — `wonLeads / totalLeads * 100`.
- **Lost-lead reasons** widget — tallied from `Lead.lostReason`.

## 14.6 Monthly performance

- 30-day activity trend on `/activity` (count of ActivityLog rows per day).
- 6-month revenue trend on Owner dashboard + Reports.
- **Active days (30d)** per agent (their profile).

## 14.7 KPI systems

Already-shipped KPIs (full list):

| Audience | KPI |
|----------|-----|
| Owner | Revenue this month (+ delta), commission pending/paid, open deals, overdue payments |
| Admin | Leads to assign, visits to verify, docs to check, payments due |
| Agent | Today's tasks, active leads, properties assigned, commission pending/earned |
| Dealer | Inventory, deals closed, share earned, share pending |
| Reports | All of the above + sales/rentals month, lead conversion, outstanding overdue, area performance, dealer performance, property-status distribution, lost-reason breakdown |
| Activity | Today, last 7 days, last 30 days, most active person |
| Per-agent | Workload (4), Results (4), Earnings (4) |

## 14.8 Forecasting possibilities

Today: none. The data supports:
- Linear forecast on the 6-month trend.
- Pipeline-weighted forecast: sum of `(stage probability × deal value)`.
- Renewal-forecast for rentals based on `renewalDate`.

## 14.9 Operational intelligence

The activity log (`/activity`) is the closest thing to "operational intelligence". Filters by entity type + user. Counts today / last week / last month. Bar chart of entity breakdown. Most-active people list with avatars.

## 14.10 CSV exports

`/api/export?type=` produces clean CSVs for: agents (rank, name, deals won, revenue, leads, conversion %), deals, payments, properties, leads, commissions. Triggered from the Reports page's "↧ Export CSV" dropdown.

---

# SECTION 15 — AUTOMATION & AI OPPORTUNITIES

This section is intentionally aspirational — the system has zero AI today. The data shape, however, is unusually clean for an ML/RAG layer because every entity has a `companyId`, every action goes through `ActivityLog`, and enums are stable.

## 15.1 AI lead qualification

**Goal**: Score every new lead 0–100 before an agent sees it.

**Inputs available now**: `source`, `budgetMin/Max`, `prefType`, `prefArea`, free-text `requirements`, time-of-day, previous lead history for the same `Client.phone/email` (would require dedup), the `interestLevel` of any historical showings for similar properties.

**Implementation sketch**: A nightly batch (Postgres `pg_cron` or a Node cron) computes a feature vector per lead and stores a `Lead.score` (new column). A logistic-regression model trained on `stage = CLOSED_WON` vs `CLOSED_LOST` outcomes from `ActivityLog` is enough for v1.

## 15.2 AI property matching

**Goal**: For every active lead, suggest top-3 matching properties.

**Inputs**: `Lead.budgetMin/Max + prefType + prefArea + requirements (semantic)` vs `Property.salePrice + type + area + description (semantic)`. Free-text requirements/description go through an embedding model (Anthropic Claude with cached system prompt, or OpenAI text-embedding-3-small). Cosine-similarity ranks candidates; budget + status filters gate.

**UI**: An inline panel on the lead detail page ("Recommended properties · refresh"). Suggestions also push as a Notification "3 new matches for {client.name}".

## 15.3 AI WhatsApp assistant

**Goal**: Inbound WhatsApp messages create / update leads automatically.

**Stack**: WhatsApp Business Cloud API → webhook → Claude (Sonnet 4.6) does intent classification + entity extraction (budget, area, type) → upsert Client + Lead. Outbound: Owners/Admins press "WhatsApp" on a lead → opens `wa.me/<phone>?text=` (no AI). Phase 2: AI-drafted replies with human approval.

## 15.4 AI sales forecasting

**Goal**: "We will close PKR 12.4M next month" with a confidence band.

**Approach**: Train a simple time-series model (Prophet, or Anthropic Claude with cached historical sales prompt) on monthly CLOSED_WON deals. Augment with pipeline-weighted forward forecasts (per-stage win probability × pending deals).

## 15.5 AI CRM automation

- Auto-create FOLLOW_UP events when a lead has been static > N days.
- Auto-suggest stage transitions when an event of type SITE_VISIT/MEETING is marked DONE.
- Auto-tag inbound clients by language preference (Urdu/English) from message content.

## 15.6 AI follow-up systems

LLM-drafted follow-up message tailored to lead stage, last interaction, and listing context, posted to a "Drafts" panel for the agent to send (don't auto-send).

## 15.7 AI document generation

The schema has `Document.type` enums for SALE_AGREEMENT and RENTAL_AGREEMENT. An AI step that takes (deal + property + client) and fills a templated DOCX agreement would close a real ops gap. Render via headless Chromium → PDF; store via the existing `/api/upload` plumbing.

## 15.8 AI analytics

Natural-language ask of the company data: "Which agents have a > 50% lost-lead rate in DHA Phase 5?" — implemented as Claude tool-calls over the Prisma read-only client (with tenant-scope automatically injected).

## 15.9 AI deal prediction

For each open Deal, predict the probability of CLOSED_WON in 30 days using features: stage age, agent's historical conversion, property's days on market, payments-so-far ratio, document-completeness, dealer presence.

## 15.10 AI voice systems

**[Inferred]** future expansion: agents dictate visit notes via the mic on their phone → Whisper / Claude voice-to-text → populated as `Showing.clientFeedback`. This is high-ROI for field agents who have wet hands or are driving.

## 15.11 Implementation possibilities (concrete)

- Use **Anthropic Claude API** (the codebase is already a Node.js Next.js app — drop in the `@anthropic-ai/sdk` and call from server actions or a new `/api/ai/*` route).
- Use **prompt caching** for the system prompt + few-shot examples — major cost saver because the same prompt is used across many agents.
- Use **tool use** for Prisma read access; the model can call `searchProperties(budget, area, type)` and reason over results.
- Run **batch jobs** (lead scoring, daily forecast) via the **Anthropic Batch API** at 50% cost.

---

# SECTION 16 — SCALABILITY ANALYSIS

## 16.1 Multi-branch scaling

Today: every record is `companyId`-scoped. There is **no Branch** entity. A real estate group with multiple branches would currently have to either:
- Treat each branch as a separate Company (loses cross-branch reporting), or
- Add a `Branch { id, companyId, name }` + `Branch` FK on User/Property/Deal and update scopes.

The schema is small and additive — `Branch` could be added in ~2 days of work plus migration.

## 16.2 Multi-company support

Already shipped. Super Admin onboards companies, each with its own data and users (with globally-unique emails — a single user account belongs to exactly one company).

## 16.3 Multi-region support

- Currency is hardcoded PKR (in `format.ts:money()`).
- Timezone is implicit server local time + browser-local `toLocaleDateString("en-GB")`.
- The `Company.settings` JSON has `currency, locale` but the rendering path doesn't yet read them.

To go multi-region: thread `currency` from `Company.settings` through `money()` / `compactMoney()`, persist timezone, format dates with `Intl.DateTimeFormat(locale, { timeZone })`.

## 16.4 High-user scaling

Today: single Node process, max 640 MB (`deploy/setup.sh:166`). For a 50-tenant 500-user deployment:
- Bump PM2 to `instances: 2, exec_mode: "cluster"` (Next.js standalone is cluster-friendly).
- Increase Postgres `shared_buffers`.
- Add connection pooling (PgBouncer) — Prisma's per-process pool will otherwise exhaust postgres backends.

## 16.5 Database scaling

- The schema already indexes the hot paths (companyId, status enums, startAt).
- Sequential `ILIKE` `contains` queries on Property.title / Client.name will slow down past ~100k properties — add `pg_trgm` indexes.
- ActivityLog will dominate row count; partition by month or by companyId.
- For multi-region: per-region read replicas with read-only Prisma clients per route.

## 16.6 API optimization

The whole app is server-rendered; there's no API to optimize per-se. But:
- Server actions are unbatched; clicking a sequence of 5 status changes hits Postgres 5x. Action-batching middleware would help.
- `revalidatePath` invalidates a path's RSC tree but doesn't share cache across instances — switching from PM2 fork to cluster would require a shared cache (Redis).

## 16.7 Caching opportunities

- Add **HTTP cache headers** to `/api/files` (already does `private, max-age=3600`) → push to a CDN with `public, max-age=`.
- **Per-tenant Redis** caching for read-heavy aggregates (agent leaderboard, monthly revenue) — they update only when deals close.
- **React cache()** wrappers around `requireCompanyUser()` so multiple server-component subtrees don't hit Postgres for the user record.

## 16.8 Queue systems

Today: synchronous everything. Real candidates for a queue:
- WhatsApp / SMS / email reminders (Phase 2).
- AI scoring/matching batches.
- Document OCR / generation.
- CSV exports of full history (currently in-process; would lock the request if export grew to 100k rows).

Recommended: **BullMQ on Redis** or **pg-boss** (uses Postgres, no new dependency).

## 16.9 Real-time scaling

The system is request-response. Adding SSE for notifications (`/api/notifications/stream`) is a 50-line change and gives the bell badge live-update without polling.

## 16.10 Cloud deployment strategies

The current deploy is single-VPS. For SaaS-grade hosting:
- **Containerize** (Dockerfile around `next start` + standalone output).
- Move Postgres to **managed** (RDS / Cloud SQL / Neon).
- Move uploads to **S3** (the abstraction is already isolated — swap `api/upload` and `api/files` for S3 client + presigned URLs).
- Put **Fly.io / Render / Vercel** in front for global edge.
- Add **CloudFront / Cloudflare** for static + tile cache.

---

# SECTION 17 — SECURITY & COMPLIANCE

## 17.1 Data protection

- **At rest**: Postgres on the VPS, no disk encryption configured by deploy/setup.sh. Recommend full-disk encryption on the VPS volume + Postgres `pgcrypto` for sensitive columns (CNICs) if added.
- **In transit**: enforced HTTPS via certbot in deploy script; nginx terminates TLS and forwards `X-Forwarded-Proto`.
- **Backups**: no automated backup job is shipped. Adding `pg_dump | gzip | restic backup` daily is a 10-line cron.

## 17.2 Role isolation

Strong. Every server action calls `requireCompanyUser()` + capability check; queries are wrapped in `propertyScope/leadScope/dealScope`; file API verifies `companyId` segment matches.

## 17.3 Access risks

- **Cross-tenant data exposure** via path traversal: blocked (`api/files/[...path]/route.ts:22, 31`).
- **Cross-tenant ID guessing**: the routes look up records as `findFirst({ where: { id, companyId } })` — wrong-tenant IDs return 404 (e.g. `properties/[id]/page.tsx:31`, `commissions/[id]/page.tsx:16`).
- **Email collisions**: `User.email` is unique platform-wide (not per-tenant); two companies can't both have `admin@x.com`. Slight friction; defensible.

## 17.4 Upload risks

- 10 MB cap, extension allowlist, UUID filename, tenant-scoped folder.
- **No virus scanning** — recommend ClamAV in a sidecar or VirusTotal API per upload.
- **No content-type sniffing** — extension is trusted. A file named `x.pdf` containing `<script>` is served as `application/pdf` (browsers won't execute it as HTML, so XSS risk is low) but mismatch should be detected by sniffing magic bytes.
- **EXIF / PII in photos** is not stripped — agent GPS may be embedded in property photos.

## 17.5 API security

- Server actions and `/api/upload` rely on cookie auth — same-site default protects cross-site form abuse for state-changing actions.
- **No CSRF token on `/api/upload`** specifically — recommend adding origin verification.
- **Rate limiting**: none. Critical for `/login` and `/api/upload`.

## 17.6 Session security

- JWT stored in httpOnly cookie.
- Default 30-day TTL — too long for an MVP that ships with demo accounts to the public URL.
- No "revoke all sessions" button.

## 17.7 GDPR-style concerns

- Data subject rights would require: export-all-my-data (the schema makes this straightforward to build), delete-my-data (cascades make this easy), erasure of audit log (would conflict with the audit purpose — typical resolution is to redact PII while keeping the action).
- Consent capture for marketing communications is not modeled.
- Data residency: today single-VPS, single country. For EU customers: deploy a regional instance.

## 17.8 Audit log needs

`ActivityLog` exists and captures every significant action with `userId`, `action`, `entityType`, `entityId`, `summary`, `meta`. Recommended enrichments: actor IP + UA + tenant + request ID, plus optional WORM (write-once) storage by streaming to S3 with object lock.

## 17.9 Financial security

- Commissions are guarded by the explicit `approveCommission` capability (OWNER/ADMIN only). Approval is logged with `approvedById` + `approvedAt`.
- Share payouts are logged + flip a boolean. No undo. **Recommended**: add a reversible `PaymentEvent` log instead of in-place mutation, so "marked paid in error" can be amended without lying to the audit log.

## 17.10 Operational integrity

- No 4-eyes principle for high-value commissions.
- No anomaly detection ("this share is 10× the agent's monthly average — confirm?").
- No file-checksum verification.

## 17.11 Recommended hardening (consolidated)

| Priority | Item |
|----------|------|
| **P0** | Rate-limit `/login` + `/api/upload`; rotate AUTH_SECRET as part of deploy; shorter JWT TTL; daily Postgres backups |
| **P1** | 2FA for OWNER/SUPER_ADMIN; forced password reset on first login; account lockout; audit-log enrichment (IP/UA) |
| **P2** | Virus scanning for uploads; magic-byte sniffing; EXIF stripping; CSP headers; HSTS; "revoke all sessions" |
| **P3** | Field-level encryption for CNIC-class data; immutable audit log to S3 Object Lock; 4-eyes on >threshold commission approvals |

---

# SECTION 18 — IMPROVEMENT ROADMAP

## 18.1 MVP gaps (real, shipping-blocking-for-some-customers)

1. **Hardcoded `SKY-####` property reference prefix** in `properties/actions.ts:41` — survives the seed (which sets per-company refPrefix) but bites real tenants. Move to `Company.settings.refPrefix`.
2. **No client de-duplication** in `/leads/new` — every lead creates a brand-new Client even if the phone matches an existing one.
3. **No re-assignment UI for property agents** after creation.
4. **No pagination** on any table.
5. **`UserStatus` (ACTIVE/SUSPENDED/INVITED)** has no toggle UI; suspended users can't sign in but admins can't suspend.
6. **No password reset / forgot-password** flow.
7. **No invitation email** for new users; admins must hand-deliver temp passwords.
8. **`Invoice` model unused** — invoice issuance + PDF would unlock real accounting workflows.
9. **The deal wizard's `commRate` (2%)** is hard-coded; should come from `Company.settings.defaultCommissionRatePct`.
10. **No mark-deal-as-LOST workflow with reason** like leads have.

## 18.2 Missing enterprise features

- Multi-branch.
- Roles beyond the 5 fixed (e.g. Finance, Operations, Legal).
- Role inheritance / custom roles / capability editor.
- Approval workflows with thresholds (auto-approve commissions < X PKR).
- Document e-signature.
- Workflow automation builder ("when X, then Y").
- Field-level audit (who changed `Property.salePrice` from A to B at T).
- Tenant-level webhooks ("on deal.closed POST to https://my-erp.com/...").

## 18.3 Missing automation

- WhatsApp / SMS / email reminders (acknowledged Phase 2).
- Auto-create FOLLOW_UP after N-day stage stasis.
- Auto-charge / payment gateway integration (Stripe, JazzCash, Easypaisa).
- Auto-renewal reminders for rentals (`RENTAL_RENEWAL` event exists; nothing creates it).
- Auto-mark payment OVERDUE when `dueDate < now` (today computed only at render).
- Auto-import leads from Zameen / Graana / Bayut portals.

## 18.4 Missing analytics

- Pipeline-weighted forecast.
- Agent goal / target attainment.
- Average time-in-stage per lead.
- Saved/scheduled reports → emailed weekly.
- Dashboards customization per user.

## 18.5 Missing AI

See Section 15 in full. Highest ROI: AI WhatsApp assistant + AI document generation + AI follow-up drafts.

## 18.6 Missing integrations

- Google / Outlook calendar sync (CalendarEvent today is a closed silo).
- Email outbound (no SMTP configured).
- Portals (Zameen, Bayut, Graana, OLX).
- Accounting (QuickBooks, Xero, Wafeq).
- e-signature (DocuSign, Adobe Sign).
- KYC providers for client onboarding.

## 18.7 UX improvements

Already listed in 13.10.

## 18.8 Mobile app opportunities

- A thin React-Native (Expo) wrapper around the agent shell using the existing API + a simple session store + native geolocation + camera-direct upload would ship a real mobile app in weeks.
- Push notifications via Expo Notifications would replace today's in-app-only model.
- Offline-first showing capture (queue → sync on reconnect).

## 18.9 SaaS transformation opportunities

- **Self-serve onboarding**: a public `/signup` that auto-provisions a tenant + first OWNER (currently SUPER_ADMIN must do it).
- **Plans + billing**: today `Company.plan` is a string with no enforcement. Add Stripe billing + plan-gated capabilities ("growth plan = up to 10 agents").
- **Trial expiration**: `CompanyStatus.TRIAL` exists but nothing flips ACTIVE→TRIAL or TRIAL→SUSPENDED on a deadline.
- **Per-tenant branding**: company logo + accent color override in settings.
- **Tenant-level export of all data** ("download my company") for compliance.

## 18.10 Prioritization

| Horizon | Item |
|---------|------|
| **Immediate (this sprint)** | Fix hardcoded `SKY-` prefix, add basic pagination, suspend/reactivate user UI, forced password reset on first login, rate-limit /login, daily Postgres backup cron. |
| **Short-term (Q3 2026)** | Client de-duplication, property-agent re-assignment, mark-deal-as-LOST flow, invoice issuance with PDF, WhatsApp deep-links, email reminders, Google Calendar sync, 2FA for OWNERs. |
| **Mid-term (Q4 2026)** | AI lead scoring + property matching, AI document generation, self-serve onboarding + Stripe billing, mobile (Expo) wrapper, push notifications, multi-branch entity. |
| **Long-term (2027+)** | Workflow builder, portal imports, e-signature, accounting integrations, multi-region tenancy, AI forecasting, AI voice notes, anomaly detection on financial flows. |

---

# SECTION 19 — FINAL SYSTEM SUMMARY

## 19.1 Overall architectural evaluation

This is a **clean, opinionated, single-deployment multi-tenant SaaS** built on the latest Next.js (App Router + Server Components + Server Actions). It has no separate API tier, no microservices, no Redis, no queues — and yet it covers the full operational surface of a real-estate agency: inventory, CRM, field ops, commissions, payments, documents, reporting.

The architecture is unusually consistent: 20 Prisma models with sensible cascades, ~30 server actions all built to the same Zod-validated, RBAC-gated pattern, one design system, one i18n cookie, one upload pipeline. There is almost no dead code and almost no abstraction that doesn't pay rent. The hand-written Urdu RTL handling is more thoughtful than most products that ship "localization".

## 19.2 Strengths

| # | Strength |
|---|----------|
| 1 | **End-to-end multi-tenancy** at the schema, RBAC and file-API layers. |
| 2 | **Defense in depth**: middleware gate + per-action capability check + query-level scope. |
| 3 | **Server-action-only mutation surface** keeps the API tiny and self-documenting. |
| 4 | **Commission engine** is a real, generalized algorithm — not a hardcoded 50/25/25. |
| 5 | **Activity log + notifications** baked into every operation, not bolted on. |
| 6 | **Bilingual (en/ur) with RTL** done properly, including font swap and Latin preservation. |
| 7 | **Mobile-first agent shell** (bottom tab nav, GPS check-in) sits beside an office shell — both responsive. |
| 8 | **Print-ready receipts** at `/receipts/[id]`. |
| 9 | **Idempotent VPS deploy script** that handles port conflicts gracefully. |
| 10 | **Demo data is rich** (seed creates 2 tenants, 86+ properties, 108+ leads, 48+ deals across 10 weeks of activity). |

## 19.3 Weaknesses

| # | Weakness |
|---|----------|
| 1 | No pagination, no bulk actions, no saved views. |
| 2 | Reference-prefix bug (`SKY-`) baked into the property create code path. |
| 3 | No client de-duplication. |
| 4 | No password reset / no first-login forced change / no rate limiting. |
| 5 | `Invoice` model unused — accounting story is half-told. |
| 6 | No real-time anything (notifications via revalidation only). |
| 7 | No queue, no email, no SMS, no WhatsApp — Phase 2 acknowledged but blocking serious deployment. |
| 8 | Hardcoded PKR + Karachi defaults in chart/map; tenant-level settings not yet honored everywhere. |
| 9 | No backup automation in the deploy. |
| 10 | JWT TTL = NextAuth default 30d; revoke-on-suspend doesn't work. |

## 19.4 Market positioning

Sits between **lightweight realty CRMs** (PropertyBase Lite, Rex.ai) and **horizontal CRMs adapted to real estate** (HubSpot for Real Estate). Differentiators:

- Built for **Pakistan/MENA market**: PKR formatting, Urdu UI, Karachi map default, dealer-supplier model (which is rare in US-centric tools).
- **Field-first agent UX** (mobile bottom-nav, GPS check-in) — most competitors are desktop-only.
- **Transparent commission engine** with live preview during deal creation — most competitors hide this in finance back-office.
- **Multi-tenant SaaS shape from day one** (most regional tools are single-tenant on-prem deployments).

## 19.5 Competitive comparison

| Capability | promptzer | HubSpot RE | Zoho CRM | Salesforce RE Cloud | Local Pakistan tools |
|------------|-----------|-----------|----------|-------------------|---------------------|
| Multi-tenant SaaS | ✅ | ✅ | ✅ | ✅ | usually no |
| Dealer-supplier model | ✅ | partial | partial | custom | rare |
| Commission engine | ✅ built-in | add-on | partial | strong | partial |
| Field GPS check-in | ✅ | partial | partial | strong | rare |
| Bilingual UR/EN + RTL | ✅ | weak | partial | strong | strong |
| AI features | ❌ today | strong | growing | strong | none |
| Mobile native | ❌ (PWA-ish) | ✅ | ✅ | ✅ | rare |
| Price point | low | high | mid | very high | low |

## 19.6 SaaS readiness

| Criterion | Status |
|-----------|--------|
| Multi-tenant | ✅ |
| Self-serve onboarding | ❌ (manual via Super Admin) |
| Billing / metering | ❌ |
| Plans + capability gating | ❌ (string column, no enforcement) |
| Onboarding email flow | ❌ |
| Forgot-password | ❌ |
| Tenant-level branding | ❌ |
| Cross-tenant isolation | ✅ |
| Audit log | ✅ |
| Backup / DR | ❌ (not automated) |
| Status page / observability | ❌ |
| SLAs / multi-region | ❌ |

**Verdict**: Tech is **SaaS-ready**; the surrounding commerce/ops layer (billing, onboarding, DR) is **not yet**. Closing those 8 items is a 2-month sprint.

## 19.7 Enterprise readiness

| Criterion | Status |
|-----------|--------|
| RBAC | ✅ |
| Audit log | ✅ |
| Tenant isolation | ✅ |
| Field-level audit | ❌ |
| SSO / SAML | ❌ |
| 2FA | ❌ |
| Data residency options | ❌ |
| Field encryption | ❌ |
| Customizable roles | ❌ |
| Webhooks / API | ❌ |
| Bulk import/export | partial (CSV export only) |
| Custom fields | ❌ |
| Workflow builder | ❌ |

**Verdict**: Strong fundamentals, missing the enterprise contract checklist. Mid-market ready; large-enterprise needs the 8 items above.

## 19.8 Investment potential

**Strengths from an investor lens**:
- Vertical SaaS in a region (Pakistan / MENA) underserved by US-built tools, with strong local-market fit (PKR, Urdu, dealer-supplier model).
- Clean codebase, current stack (Next.js 16, React 19, Prisma 6) — short integration ramp for hires.
- The 20-model multi-tenant data layer is the moat — copying it from scratch is 6 months of careful work.
- Clear AI surface: commission patterns, lead scoring, property matching, document generation all "next features", not "rebuilds".
- Phase-2 features (WhatsApp, email, payments) are exactly what local-market customers will pay for.

**Risks**:
- Local competition (Zameen, Bayut have moved into agent tooling).
- Currency / regional concentration.
- Customer success / sales motion not visible in this codebase (separate concern).

## 19.9 Technical maturity

On a 1–5 scale per axis:

| Axis | Rating |
|------|--------|
| Schema design | 4.5 / 5 |
| Code quality | 4 / 5 |
| Test coverage | **0 / 5** — no test files in the repo (no `__tests__`, no Vitest config, no Playwright config) |
| Observability | 1 / 5 (PM2 logs only) |
| CI/CD | 2 / 5 (GH Action → SSH → bash) |
| Security posture | 2.5 / 5 |
| Performance budgeting | 1 / 5 (no Lighthouse, no metrics, no DB query budget) |
| Documentation | 3 / 5 (README + DEPLOY.md + AGENTS.md are good; no architectural docs in-repo until this export) |
| Accessibility | 3 / 5 (icons have `aria-hidden`, buttons have labels, no formal audit) |
| Internationalization | 4 / 5 (RTL + Urdu shipping, only Urdu numerals partially handled in charts) |

## 19.10 Closing assessment

promptzer CRM is the **right product, built the right way for its current size**. It's a Next.js 16 reference implementation of vertical multi-tenant SaaS — small enough to be maintained by one engineer, sophisticated enough to be sold to medium agencies. To become a real SaaS business it needs (a) self-serve onboarding + billing, (b) WhatsApp/email channels, (c) basic AI features (matching, scoring, agreement generation), (d) tests + observability, (e) the 8 enterprise checklist items.

The strongest single moat right now is the **commission engine + multi-supplier (dealer/owner) data model** — those are bespoke to this vertical and are typically what makes a real-estate operator stop using spreadsheets.

— End of export —
