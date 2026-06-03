# Proptimizr — Real Estate CRM / ERP

An internal back-office for Pakistani real-estate agencies and property
developers: properties, leads, agents, dealers, deals, commissions, payments,
documents, reporting, WhatsApp messaging, and AI-assisted next-action /
reply-draft suggestions. Multi-tenant, role-aware, mobile-friendly for
agents in the field. Production at **crm.proptimizr.com**.

## Stack

- **Next.js 16** (App Router, Server Components, Server Actions, RSC)
- **TypeScript** + **Tailwind CSS 4**
- **Prisma 6** + **PostgreSQL** (multi-tenant: every record carries `companyId`)
- **Auth.js (NextAuth v5)** — credentials login, JWT sessions, role-based access
- **Zod** at every server-action boundary
- **Recharts** + **Leaflet** for dashboards and map views
- **@anthropic-ai/sdk** (Claude Opus 4.7) for AI features — see [`deploy/AI.md`](deploy/AI.md)
- **Postgres-backed job queue** (no Redis) driven by a `/api/jobs/tick` cron — see [`deploy/JOBS.md`](deploy/JOBS.md)
- **English + Urdu (RTL)** i18n with localised digits and PKR formatting

## Roles (requirements §3)

| Role | Scope |
|------|-------|
| Super Admin | Every company on the platform (`/admin/companies`) |
| Owner | Full visibility of their own company |
| Admin | Daily operations inside one company |
| Agent | Only their own leads, properties, calendar, visits |
| Dealer | Only their own inventory, deals and share |

RBAC is enforced in `src/lib/rbac.ts` (capabilities) and `src/lib/scope.ts`
(row-level scoping), checked inside every server action — not just in the menus.

## Getting started

### 1. Database

Create the database and a role (one-time, needs a Postgres superuser):

```bash
sudo -u postgres psql -c "CREATE ROLE zsn WITH LOGIN SUPERUSER PASSWORD 'zsn';" \
                      -c "CREATE DATABASE realestate_crm OWNER zsn;"
```

Adjust `DATABASE_URL` in `.env` if you use different credentials (see `.env.example`).

### 2. Install, migrate, seed

```bash
npm install
npm run db:push      # create tables from prisma/schema.prisma
npm run db:seed      # demo company + users + properties + a closed deal
npm run dev          # http://localhost:3000
```

### 3. Demo accounts (password: `password`)

| Role | Email |
|------|-------|
| Owner | `owner@proptimizr.test` |
| Admin | `admin@proptimizr.test` |
| Agent | `agent@proptimizr.test` |
| Dealer | `dealer@proptimizr.test` |
| Super Admin | `support@proptimizr.com` |

## Modules (Milestones 1–7)

- **Foundation** — auth, 5 roles, RBAC, role-routed dashboards, activity log, notifications
- **Properties & Dealers** — full property records, status timeline, dealer inventory & share
- **Leads / CRM** — 9-stage pipeline, sources, preferences, assignment, lost-reason tracking
- **Agents, Calendar & Visits** — leaderboard, calendar/tasks, GPS + manual visit check-in
- **Deals, Commission & Payments** — sales & rentals, flexible 50/25/25 split with dealer
  share, approval + payout history, payments/receipts/dues/overdue
- **Documents & Reports** — verification & expiry tracking, the core report set
- **Mobile & notifications** — mobile-first agent panel, in-app alerts

## Commission engine

`src/lib/commission.ts` splits a deal's commission per the company's default rule
(or a per-property override). Defaults to 50% main agent / 25% company / 25% co-agents,
with an optional dealer share, and re-homes the co-agent slice when there are none.
Edit the default split in **Settings** (owner only).

## Project layout

```
prisma/schema.prisma     full data model (requirements §19)
prisma/seed.ts           demo data
src/auth.ts              NextAuth config
src/middleware.ts        route protection
src/lib/                 prisma, rbac, scope, metrics, commission, format, activity
src/components/          ui primitives, dashboards, shell, per-module controls
src/app/(app)/           authenticated, role-aware screens (one folder per module)
src/app/login/           sign-in
```

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run db:push` | Push schema to the DB |
| `npm run db:seed` | Seed demo data |
| `npm run db:studio` | Prisma Studio |
| `npm run typecheck` | `tsc --noEmit` across the whole project |
| `npm test` | Run the unit test suite under `test/` (no DB required) |

## Files & uploads

Documents upload to a tenant-scoped local directory (`uploads/<companyId>/…`) via
`POST /api/upload`, and are served back through `GET /api/files/...` which enforces
that the caller belongs to the owning company. Swap the two handlers for S3 in
Phase 2 — the rest of the app only stores the returned URL.

## Plans, billing and per-tenant limits

`lib/plans.ts` defines five tiers (FREE / TRIAL / STARTER / GROWTH / PRO)
with caps on users + properties. Enforcement happens at every create
boundary (`canAddUser`, `canAddProperty`). `Company.billingStatus`
(TRIAL / ACTIVE / GRACE / PAST_DUE / CANCELLED) is independent of platform
access — a `PAST_DUE` tenant keeps working until ops decides to suspend.
`Company.trialEndsAt` triggers an automatic `TRIAL → PAST_DUE` sweep via
the job queue.

## Background jobs

A Postgres-backed queue handles trial-expiry sweeps, WhatsApp inbound
processing, and AI-assist work. A cron hits `/api/jobs/tick` once a minute
(bearer-authenticated via `JOBS_TICK_TOKEN`). The runner is race-safe under
PM2 cluster mode (atomic `updateMany`-claim), supports exponential backoff,
idempotency keys for webhook dedup, and has a reaper sweep for crashed
runners. Full ops guide: [`deploy/JOBS.md`](deploy/JOBS.md).

## WhatsApp integration

Outbound is wa.me links built from per-template helpers (`lib/whatsapp.ts`)
with a tenant signature override. Inbound is a Meta Cloud API webhook at
`/api/webhooks/whatsapp` with HMAC signature verification, queued processing,
and Claude-powered intent classification. Tenant routing uses
`Company.whatsappPhoneId` against Meta's `phone_number_id`. See
[`deploy/AI.md`](deploy/AI.md) for the routing setup.

## AI features (Phase 9)

Three surfaces, all gated by plan + a per-tenant master switch:

- **Lead assistant** on the lead detail page — "Suggest next action" and
  "Draft WhatsApp reply" with optional steering.
- **Inbound WhatsApp classifier** — structured `{intent, urgency, summary, …}`
  per message.
- **Owner weekly insight** on `/reports` — narrative of week-over-week deltas.

Anthropic prompt caching is enabled on every system prompt; the DB layer
caches identical inputs for 30 min / 6 h depending on surface so repeated
clicks don't burn budget. Setup, costs, and monitoring: [`deploy/AI.md`](deploy/AI.md).

## Testing

`npm test` runs the unit suite (no DB needed) covering RBAC, lead
health/scoring, format/i18n, the AI plan budget table, and the WhatsApp
classifier's tolerant JSON parser. Tests use Node's built-in `node:test`
runner via `tsx` — no test framework dependency. For the manual release
checklist see [`QA.md`](QA.md).

## Deployment

Production runs on a single Ubuntu VPS: nginx → PM2 fork → Next.js
standalone → Postgres + Let's Encrypt + a cron-driven jobs tick. Full
playbook in [`deploy/DEPLOY.md`](deploy/DEPLOY.md); backup retention in
[`deploy/BACKUP.md`](deploy/BACKUP.md).
