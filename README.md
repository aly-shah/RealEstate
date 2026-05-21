# Scalamatic Estate — Real Estate CRM / ERP

An internal back-office for real estate agencies and property developers: properties,
leads, agents, dealers, deals, commissions, payments, documents and reporting — by role,
and mobile-friendly for agents in the field. Built from
`RealEstate-CRM-ERP-Requirements.html` (admin/ERP side only — no public buyer portal).

## Stack

- **Next.js 16** (App Router, Server Components, Server Actions)
- **TypeScript** + **Tailwind CSS 4**
- **Prisma 6** + **PostgreSQL** (multi-tenant: every record carries `companyId`)
- **Auth.js (NextAuth v5)** — credentials login, JWT sessions, role-based access
- **Zod** for input validation at every server-action boundary

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
| Owner | `owner@skyline.test` |
| Admin | `admin@skyline.test` |
| Agent | `agent@skyline.test` |
| Dealer | `dealer@skyline.test` |
| Super Admin | `super@scalamatic.test` |

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

## Files & uploads

Documents upload to a tenant-scoped local directory (`uploads/<companyId>/…`) via
`POST /api/upload`, and are served back through `GET /api/files/...` which enforces
that the caller belongs to the owning company. Swap the two handlers for S3 in
Phase 2 — the rest of the app only stores the returned URL.

## Notes / Phase 2

Phase 2 items from the spec — SMS/WhatsApp/email reminders, payment gateway,
e-signature, multi-branch, native app, AI features — are intentionally out of
this MVP.
