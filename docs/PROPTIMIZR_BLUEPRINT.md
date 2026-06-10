# Proptimizr — Technical & Operational Blueprint

> **Purpose & provenance.** This document is a ground-truth reverse-engineering of the Proptimizr real-estate CRM, derived directly from the source tree (`prisma/schema.prisma`, `src/lib/**`, `src/app/(app)/**`). Every constant, formula, status machine, and permission row below was read from code, not inferred. Where a capability commonly expected of a "modern real-estate CRM" is **absent**, it is flagged explicitly (`❌ ABSENT`) so downstream analysis is not misled into optimizing something that does not exist.
>
> **Market context.** Proptimizr targets the **Pakistan brokerage market** (PKR currency, MARLA/KANAL land units, WhatsApp as the primary channel, Zameen/Graana/OLX as lead portals). This shapes nearly every design decision and is critical for any feature recommendation.

---

## 0. Orientation: What Proptimizr Is and Is Not

| Dimension | Reality in code |
|---|---|
| Product type | Multi-tenant SaaS CRM **+ light ERP** (deals, payments, commissions, invoices, documents) |
| Primary geography | Pakistan (PKR, MARLA/KANAL, Asia/Karachi) |
| Primary comms channel | **WhatsApp** (Meta Cloud API + `wa.me` deep links). ❌ No SMS, ❌ no email delivery |
| Listing data source | **Manual entry only.** ❌ No MLS/RESO/IDX feed ingestion |
| AI | Anthropic Claude (`claude-opus-4-7`) for advisory text; OpenAI `gpt-4o-mini` for listing copy |
| Automation backbone | Postgres-backed job queue drained by a cron `tick` endpoint. ❌ No Redis, ❌ no external workers |
| Lead routing | **Manual triage only.** ❌ No round-robin / geographic / shark-tank algorithm |
| Integrations bus | ❌ No Zapier, no webhooks-out, no public API |

---

## 1. System Architecture & Tech Stack

### 1.1 Stack (Known, from the repo)

| Layer | Technology | Notes |
|---|---|---|
| Framework | **Next.js 16** (App Router, React Server Components, Server Actions, Turbopack) | Note: this repo runs a build of Next with breaking changes vs. mainline; conventions differ |
| UI runtime | **React 19** | |
| Language | **TypeScript** (strict) | |
| Styling | **Tailwind CSS 4** | |
| ORM | **Prisma 6** | `prisma db push` schema sync (no migration history); hand-rolled `CONCURRENTLY` index migrations under `deploy/migrations/` |
| Database | **PostgreSQL** | `pg_trgm` GIN indexes for substring search |
| Auth | **NextAuth v5 (beta)** | JWT strategy, 8-hour session, credentials provider, bcrypt |
| AI (advisory) | **Anthropic SDK** — `claude-opus-4-7`, `max_tokens: 800`, `thinking: { type: "adaptive" }` | `src/lib/ai/client.ts` |
| AI (listing copy) | **OpenAI** Chat Completions — `gpt-4o-mini`, `response_format: json_object` | `src/lib/ai/openai.ts` |
| Messaging | **Meta WhatsApp Cloud API v21.0** | outbound text + approved templates; inbound webhook |
| Jobs | Postgres `Job` table + `/api/jobs/tick` cron endpoint | `src/lib/jobs/**` |
| Process mgr | **PM2** (`promptzer-crm`), non-root user | |
| Web server | **nginx** reverse proxy (TLS, `X-Forwarded-Proto`, 12 MB body cap) | |
| Deploy | **GitHub Actions → SSH (appleboy) → `deploy/redeploy.sh`** on push to `main` | `git pull && npm ci && prisma db push && build && pm2 reload` |
| Secrets at rest | **AES-256-GCM** envelope (`enc:v1:`), key derived from `AUTH_SECRET` | `src/lib/crypto.ts` |

### 1.2 Multi-Tenancy Model

- **Tenant = `Company`.** Almost every row carries `companyId`. Tenant isolation is enforced *in every query* via scope helpers (see §3.5), not via Postgres RLS.
- `User.companyId` is nullable: `SUPER_ADMIN` (platform operator) has `companyId = null` and operates the cross-tenant `/admin/companies` console.
- Cascade strategy: deleting a `Company` cascades to all child rows; deleting a *counterparty* inside a tenant (agent, client, dealer, property) generally `SetNull`s the FK so historical/financial records (deals, commissions, payments, documents) survive.

### 1.3 Data Model — Entity Relationships (verified from `schema.prisma`)

```
Company (tenant root)
├── User (Role: SUPER_ADMIN|OWNER|ADMIN|AGENT|DEALER)
│     ├── LeadAgent ............... 1 User → N Lead   (Lead.agentId, SetNull)
│     ├── PropertyAgent ........... M:N User ↔ Property (junction, assignedAt)
│     ├── DealAgent .............. M:N User ↔ Deal (role: MAIN|CO_AGENT)
│     ├── CommissionShare ........ 1 User → N share (userId, SetNull)
│     └── Dealer (DealerUser) .... 0..1 User ↔ Dealer  (a dealer login)
├── Project ...................... 1 Project → N Property (off-plan grouping)
├── Dealer (inventory supplier) .. 1 Dealer → N Property, N Deal, N CommissionShare
├── Property
│     ├── PropertyMedia (PHOTO|VIDEO|FLOOR_PLAN|BROCHURE)
│     ├── PropertyAgent (assigned agents)
│     ├── CommissionRule (override; else company default)
│     ├── share* (shareSlug/shareEnabled/sharedById → public /p/[slug])
│     └── version (optimistic lock)
├── Client (buyer/seller/tenant/investor — undifferentiated; see §2.4)
│     ├── Lead, Showing, Deal, Invoice, Document
├── Lead (the pipeline object)
│     ├── client (Client?), agent (User?), property (Property?)
│     ├── stage (LeadStage ×10), source (LeadSource ×7)
│     ├── budgetMin/Max, prefType, prefArea, requirements
│     ├── scoreOverride (HOT|WARM|COLD), importSource (free text)
│     ├── lastContactedAt (freshness proxy)
│     └── → CalendarEvent, Deal, Showing
├── CalendarEvent (type ×8, status ×4) ← lead/property/agent
├── Showing (site visit) ← agent, client?, lead?, property
│     ├── checkIn/Out + GPS (lat/lng), verification (PENDING|VERIFIED|REJECTED|FLAGGED)
│     ├── interestLevel (HIGH|MEDIUM|LOW|NONE), clientFeedback
│     └── GpsLog[] (kind IN|OUT)
├── Deal (type SALE|RENTAL; status ×7; agreement ×4)
│     ├── 1:1 Sale (salePrice, tokenAmount, bookingAmount, downPayment)
│     ├── 1:1 Rental (monthlyRent, deposit, leaseMonths, renewalDate)
│     ├── DealAgent[] (MAIN + CO_AGENTs)
│     ├── 1:1 Commission → CommissionShare[]
│     ├── Payment[], Invoice[], Document[]
│     └── lead?, client?, dealer?
├── Payment (type ×7, status ×4, version, dueDate/paidAt) ← deal?, invoice?
├── Invoice (status ×4, number unique/tenant) ← deal?, client?
├── Commission (status ×4, version, approvedBy) ── 1:1 Deal
│     └── CommissionShare (party: AGENT_MAIN|COMPANY|AGENT_OTHER|DEALER; pct, amount, paid)
├── CommissionRule (mainAgentPct/companyPct/otherAgentPct/dealerPct, noOtherFallback)
├── Document (type ×9, verification ×4, expiryDate) ← polymorphic: property/client/dealer/deal
├── ActivityLog (audit trail; action/entityType/entityId/summary/meta JSON)
├── Notification (type ×9, channel ×4, read) → User
├── AiSuggestion (type ×5, inputHash, token accounting) — cache + budget ledger
├── WhatsAppTemplate (mirror of Meta-approved templates)
├── Job (queue: status ×4, runAt, attempts, idempotencyKey)
└── IdempotencyKey (financial-mutation dedup, 7-day TTL)
```

### 1.4 Integrations — Required vs. Present (the gap map)

The prompt asked about MLS/RESO, Twilio, SendGrid, Zapier. **Grep-confirmed: none are present.** This table is the integration gap surface for the optimizing model.

| Integration | Expected role | Status in Proptimizr | Recommendation hook |
|---|---|---|---|
| **MLS / RESO Web API / IDX** | Auto-ingest listings, sync status, photos | ❌ ABSENT — all listings manually keyed | Pakistan has no MLS/RESO; the analog is **Zameen/Graana/OLX portal feeds**. `Lead.importSource` already tags portal origin; a portal-listing *ingest* does not exist |
| **Twilio (SMS/voice)** | OTP, SMS nurture, click-to-call | ❌ ABSENT | All comms are WhatsApp; SMS fallback would need a provider |
| **SendGrid / SES (email)** | Transactional + drip email | ❌ ABSENT — `NotificationChannel.EMAIL` enum exists but **no producer creates EMAIL rows** | Notifications are in-app only |
| **Zapier / public API / webhooks-out** | Automation bus | ❌ ABSENT | No outbound webhooks, no REST/GraphQL public API |
| **WhatsApp (Meta Cloud API)** | Primary messaging | ✅ PRESENT — outbound text + templates, inbound webhook, per-tenant phone line | The one real external comms channel |
| **OpenStreetMap / Photon** | Address autocomplete + geocoding | ✅ PRESENT (Pakistan-only filter) | Used in Add/Edit property |
| **Map tiles** | Property map | ✅ PRESENT (`/map`, `MapView`) | |
| **Anthropic + OpenAI** | AI advisory + copy | ✅ PRESENT | See §3.6 |

---

## 2. Core Modules & Data Objects

### 2.1 Lead Management

#### 2.1.1 Lead object — fields (verbatim from schema)

| Field | Type | Semantics |
|---|---|---|
| `id` | cuid | PK |
| `companyId` | FK | tenant |
| `clientId` | FK? (SetNull) | the human; lead survives client deletion |
| `agentId` | FK? (SetNull) | owning agent; **null = unassigned** |
| `propertyId` | FK? (SetNull) | property of interest (optional) |
| `stage` | `LeadStage` | pipeline position (default `NEW`) |
| `source` | `LeadSource` | origin channel (default `OTHER`) |
| `budgetMin` / `budgetMax` | Decimal(14,2)? | PKR budget band |
| `prefType` | `PropertyType?` | desired type |
| `prefArea` | String? | desired locality (free text) |
| `requirements` | String? | free-text needs |
| `notes` | String? | |
| `lostReason` | String? | required when stage → CLOSED_LOST |
| `scoreOverride` | `LeadScoreOverride?` | manual HOT/WARM/COLD pin (overrides computed band) |
| `importSource` | String? | free-text portal tag: `ZAMEEN`, `GRAANA`, `OLX`, `FACEBOOK`, `CSV` |
| `lastContactedAt` | DateTime? | **explicit freshness proxy** — set by recordShowing + by completing a SHOWING/MEETING/FOLLOW_UP event; falls back to `createdAt` |
| `createdAt` / `updatedAt` | DateTime | |

#### 2.1.2 Lead pipeline stages (`LeadStage`, 10 values, ordered)

`NEW → CONTACTED → INTERESTED → SITE_VISIT → PROPERTY_SHOWN → NEGOTIATION → TOKEN_BOOKING → PAYMENT → CLOSED_WON` (terminal) | `CLOSED_LOST` (terminal)

#### 2.1.3 Lead sources (`LeadSource`, 7 values)

`REFERRAL`, `WALK_IN`, `SOCIAL_MEDIA`, `PORTAL`, `CALL`, `REPEAT_CLIENT`, `OTHER`
*(Note: this is the canonical enum. `importSource` is a separate, free-text field used for portal/CSV provenance — do not conflate.)*

#### 2.1.4 Lead Scoring algorithm — `src/lib/lead-score.ts` (verbatim weights)

Pure function `scoreLead(input) → { score 0–100, band, reasons[], overridden }`. Band thresholds: **`score ≥ 70 → HOT`, `≥ 40 → WARM`, `< 40 → COLD`** (`bandFor`, lines 67–71).

**Inputs:** `stage`, `source`, `hasBudget`, `hasProperty`, `updatedAt`, `topInterest` (max InterestLevel across showings), `hasShowing`, `override`.

**Additive point model** (final score clamped to `[0,100]` and rounded, line 149):

| Signal | Points | Source line |
|---|---|---|
| **Stage** NEW / CONTACTED / INTERESTED / SITE_VISIT / PROPERTY_SHOWN / NEGOTIATION / TOKEN_BOOKING / PAYMENT / CLOSED_WON | 10 / 20 / 35 / 45 / 55 / 75 / 85 / 92 / 100 | 36–47 |
| **Stage** CLOSED_LOST | hard **0** (terminal floor; no signal can lift it) | 46, 90–99 |
| **Source** REFERRAL / REPEAT_CLIENT | +12 each | 51–52 |
| **Source** WALK_IN / CALL / PORTAL / SOCIAL_MEDIA / OTHER | +8 / +6 / +4 / +4 / +0 | 53–57 |
| **Budget captured** (`hasBudget`) | +6 | 114–117 |
| **Linked to property** (`hasProperty`) | +8 | 118–121 |
| **Recent activity** (`updatedAt` ≤ 7 days) | +8 | 127–129 |
| **Quiet** (`updatedAt` > 14 days) | −6 | 130–133 |
| **Has been shown a property** (`hasShowing`) | +4 | 136–139 |
| **Top interest** HIGH / MEDIUM / LOW / NONE | +18 / +8 / +2 / **−6** | 60–65, 140–146 |

**Override semantics:** when `scoreOverride` is set, the raw score is *still computed and returned*, but the returned `band` is forced to the override value and `overridden = true` (lines 151–158). UI can show "auto 62 → admin HOT".

#### 2.1.5 Lead Health (stale detection) — `src/lib/lead-health.ts`

Function `leadHealth(input) → { health, reasons[] }` where `health ∈ {FRESH, ATTENTION, STALE, URGENT}`.

**Inputs:** `stage`, `lastContactedAt` (→ falls back to `createdAt`), `unassigned`, `hasFutureEvent`.

**Per-stage day thresholds:**

| Stage | `attentionAfter` (days) | `staleAfter` (days) |
|---|---|---|
| NEW | 1 | 2 |
| CONTACTED | 2 | 7 |
| INTERESTED | 3 | 7 |
| SITE_VISIT | 3 | 7 |
| PROPERTY_SHOWN | 3 | 7 |
| NEGOTIATION | 5 | 14 |
| TOKEN_BOOKING | 7 | 14 |
| PAYMENT | 10 | 21 |

**Branching:**
1. `CLOSED_WON`/`CLOSED_LOST` → always **FRESH**.
2. `unassigned == true` → immediate **URGENT**.
3. `ageDays = (now − (lastContactedAt ?? createdAt)) / 86_400_000`:
   - `ageDays ≥ staleAfter × 1.5` → **URGENT**
   - `≥ staleAfter` → **STALE**
   - `≥ attentionAfter` → **ATTENTION**
   - else → **FRESH**
4. **Follow-up bump:** if `hasFutureEvent == false` and computed health is FRESH → bump to **ATTENTION** ("No follow-up scheduled"); if already ATTENTION/STALE, append the reason without downgrading.

#### 2.1.6 Lead↔Property Matching — `src/lib/lead-matching.ts`

Fetches up to `take × 6` (default 30) candidate properties (company-scoped, status ∈ AVAILABLE/UNDER_NEGOTIATION/RESERVED, optionally filtered by `prefType`), scores in JS, returns top `take` (default 5). **Does not hard-filter by budget** (allows near-matches).

| Signal | Points |
|---|---|
| Type match (`prefType == property.type`) | +30 |
| Area match (property area contains `prefArea`, case-insensitive) | +30 |
| Within budget (`min ≤ price ≤ max`) | +30 |
| Slightly above budget (`price ≤ max × 1.1`) | +12 |
| Below typical floor (`price ≥ min × 0.85`) | +8 |
| Listing-intent match (budget `≥ 10,000,000` ⇒ SALE intent; smaller ⇒ RENT; property `listingType` agrees) | +8 |

Score capped at 100; zero-score matches dropped; sorted desc. Returns `{ id, reference, title, area, type, listingType, salePrice, monthlyRent, score, reasons[] }`.

#### 2.1.7 Auto-Follow-up scheduling — `src/lib/lead-followups.ts`

`scheduleAutoFollowUp(lead)` creates a single `CalendarEvent(type=FOLLOW_UP, status=SCHEDULED)`:

| Stage | Cadence |
|---|---|
| NEW | +24 h |
| CONTACTED | +48 h |
| INTERESTED | +72 h |
| (all others) | none (agent-driven) |

**Guards:** requires `agentId` (unassigned leads get none); **skips if any future `SCHEDULED` event of type FOLLOW_UP/SHOWING/MEETING already exists** (dedup). Title is stage-specific ("First contact — {client}", "Follow up — {client}", "Re-engage — {client}").

### 2.2 Property / Listing Management

#### 2.2.1 Property object — fields (verbatim)

| Group | Fields |
|---|---|
| Identity | `reference` (auto `PREFIX-0001`, unique per tenant), `title`, `description`, `version` (optimistic lock) |
| Classification | `type` (`PropertyType` ×7: RESIDENTIAL, COMMERCIAL, PLOT, APARTMENT, VILLA, SHOP, OFFICE), `listingType` (SALE/RENT/BOTH), `status` (`PropertyStatus` ×7) |
| Supplier | `dealerId` (Dealer?) **or** inline `ownerName` / `ownerPhone` |
| Project | `projectId` (off-plan grouping) |
| Location | `city`, `area`, `address`, `latitude`, `longitude`, `landmarks` |
| Pricing | `salePrice`, `monthlyRent`, `deposit` (all Decimal(14,2)?), `negotiable` (bool, default true) |
| Size/layout | `coveredArea`, `plotSize` (Float), `areaUnit` (SQFT/SQM/SQYD/MARLA/KANAL, default SQFT), `bedrooms`, `bathrooms`, `floors`, `parking`, `yearBuilt` |
| Amenities | `amenities String[]` — curated chip set (Parking, Lift, Backup Generator, CCTV, Servant Quarter, Gym, Pool, Garden, Furnished, Solar, Boundary Wall, Corner, Park Facing, Main Road, Water Boring, …) |
| Availability | `availableFrom`, `rentedUntil` |
| Commission | `commissionRuleId` (override; else company default) |
| Public share | `shareSlug` (unguessable token), `shareEnabled`, `sharedById` → served at `/p/[slug]` |
| Media | `PropertyMedia[]` — PHOTO / VIDEO / FLOOR_PLAN / BROCHURE |

#### 2.2.2 Property statuses (`PropertyStatus`, 7)

`AVAILABLE`, `RESERVED`, `UNDER_NEGOTIATION`, `RENTED`, `SOLD`, `INACTIVE`, `PENDING_VERIFICATION` (default on create).

> Auto-transition: closing a deal `CLOSED_WON` sets the linked property to `SOLD` (SALE) or `RENTED` (RENTAL). See §3.

#### 2.2.3 Commercial vs Residential

Encoded purely via the `type` enum; `RESIDENTIAL_TYPES = {APARTMENT, VILLA, RESIDENTIAL}` drives **conditional form fields** (bedrooms shown only for residential; `PLOT` hides covered area / rooms / baths / floors / parking / year-built). There is no separate commercial sub-schema (no cap-rate, NOI, lease-type, tenant-roll fields). ❌ **No staging tracker, ❌ no virtual-tour object, ❌ no price-history table** — `Property.version` increments on edit but **prior values are not retained** (no temporal/audit row for price changes).

### 2.3 Transaction & Escrow Tracking

> **Framing:** there is **no formal escrow ledger / trust-account model.** "Escrow" here is the de-facto composite of **Deal milestones (status) + staged Payments + Commission split**. Document handling is reference-only (❌ no compliance gate). Be precise about this when recommending features.

#### 2.3.1 Deal object & milestones

- `type`: `SALE | RENTAL`
- `status` (`DealStatus` ×7): `DRAFT → NEGOTIATION → TOKEN → BOOKED → AGREEMENT → CLOSED_WON` | `CLOSED_LOST`
  - ⚠️ **Free-form state machine:** any status → any status is allowed (no transition guard). `CLOSED_LOST` requires a non-empty `lostReason` (server backstop). `CLOSED_WON` stamps `closeDate = now()` and flips the property to SOLD/RENTED.
- `agreement` (`AgreementStatus` ×4): `NONE → DRAFT → SIGNED → COMPLETED` — **a label only; not gated or automated.**
- Sub-records (1:1):
  - **`Sale`**: `salePrice`, `tokenAmount?`, `bookingAmount?`, `downPayment?`
  - **`Rental`**: `monthlyRent`, `deposit?`, `leaseMonths?`, `renewalDate?`
- Agents: `DealAgent[]` with `role MAIN | CO_AGENT`.
- `reference` auto-allocated (`nextDealReference`, P2002 retry × 5).

#### 2.3.2 Payment object

- `type` (`PaymentType` ×7): `TOKEN, BOOKING, DOWN_PAYMENT, INSTALMENT, RENT, DEPOSIT, COMMISSION`
- `status` (`PaymentStatus` ×4): `PENDING, PARTIAL, PAID, OVERDUE`
- `amount` Decimal(14,2), `method?`, `receiptNo?`, `dueDate?`, `paidAt?`, `version` (optimistic lock)
- Links: `dealId?`, `invoiceId?` (both SetNull — payment is the source of truth for "money received")
- **Recording flow** (`recordPayment`): validates, tenant-verifies the invoice, auto-derives `dealId` from the invoice when absent, sets `paidAt` only when `status == PAID`, optional **idempotency** via client UUID (`runOnce(companyId, "payment.create", key)`).
- **`markPaymentPaid`**: compare-and-swap guarded — `casUpdateGuarded(payment, {status: {not: PAID}}, {status: PAID, paidAt: now})` so two concurrent clicks can't double-process.

#### 2.3.3 Invoice object & auto-promotion

- `status` (`InvoiceStatus` ×4): `DRAFT, ISSUED, PAID, CANCELLED`; `number` unique per tenant; `amount`, `dueDate?`, `description?`, `footer?`.
- **Auto-promotion** (`recomputeInvoiceStatus`): skips DRAFT/CANCELLED; sums `Payment.amount WHERE status=PAID AND invoiceId=…`; if `sumPaid ≥ invoice.amount` → `PAID`, else stays `ISSUED`. No reverse transition; **no automatic `PARTIAL` state for invoices.**

#### 2.3.4 Commission engine

**Rule (`CommissionRule`)** — defaults: `mainAgentPct 50`, `companyPct 25`, `otherAgentPct 25`, `dealerPct 0`, `noOtherFallback MAIN`. A rule may be set per-property; else the company `isDefault` rule applies.

**Split algorithm — `src/lib/commission.ts → computeCommission(rule, ctx)`** (complete, verbatim):

```typescript
export function computeCommission(rule: CommissionRuleInput, ctx: CommissionContext): ComputedShare[] {
  const round = (n: number) => Math.round(n * 100) / 100;
  const hasOthers = ctx.otherAgents.length > 0;
  const hasDealer = !!ctx.dealer;

  let mainPct = rule.mainAgentPct;
  let companyPct = rule.companyPct;
  const otherPctTotal = rule.otherAgentPct;
  let dealerPct = hasDealer ? rule.dealerPct : 0;

  // Re-home the "other agents" slice when there are none.
  if (!hasOthers) {
    if (rule.noOtherFallback === "COMPANY") companyPct += otherPctTotal;
    else mainPct += otherPctTotal;
  }
  // No dealer → their slice goes to the company.
  if (!hasDealer && rule.dealerPct > 0) companyPct += rule.dealerPct;

  const shares: ComputedShare[] = [];

  if (ctx.mainAgent) {
    shares.push({ party: "AGENT_MAIN", userId: ctx.mainAgent.id,
      label: `${ctx.mainAgent.name} (main)`, pct: round(mainPct),
      amount: round((ctx.total * mainPct) / 100) });
  }

  shares.push({ party: "COMPANY", label: "Company",
    pct: round(companyPct), amount: round((ctx.total * companyPct) / 100) });

  if (hasOthers) {
    const each = otherPctTotal / ctx.otherAgents.length;          // equal split among co-agents
    for (const a of ctx.otherAgents) {
      shares.push({ party: "AGENT_OTHER", userId: a.id,
        label: `${a.name} (co-agent)`, pct: round(each),
        amount: round((ctx.total * each) / 100) });
    }
  }

  if (hasDealer && dealerPct > 0) {
    shares.push({ party: "DEALER", dealerId: ctx.dealer!.id,
      label: ctx.dealer!.name, pct: round(dealerPct),
      amount: round((ctx.total * dealerPct) / 100) });
  }

  // Absorb any rounding drift into the first share so totals reconcile to ctx.total.
  const sum = shares.reduce((s, x) => s + x.amount, 0);
  const drift = round(ctx.total - sum);
  if (drift !== 0 && shares.length > 0) shares[0].amount = round(shares[0].amount + drift);

  return shares;
}
```

Key invariants: the four rule percentages are expected to sum to 100; absent co-agents re-home to MAIN or COMPANY per `noOtherFallback`; absent dealer re-homes to COMPANY; co-agents split `otherAgentPct` **equally**; rounding drift is absorbed into the first share (AGENT_MAIN if present, else COMPANY).

**Commission lifecycle (`CommissionStatus` ×4):** `DRAFT → PENDING_APPROVAL → APPROVED → PAID`.
- `generateCommission(dealId, total)`: idempotent (one Commission per Deal); selects rule (property override → company default); builds shares; creates Commission at `PENDING_APPROVAL`; notifies all OWNER/ADMIN (`COMMISSION_APPROVAL`).
- `approveCommission`: requires `approveCommission` cap; **CAS-guarded** on `status=PENDING_APPROVAL` (race-safe); stamps `approvedById/At`, optional `approvalNote`; notifies share-holding agents.
- `rejectCommission`: requires reason; only from `PENDING_APPROVAL`; **deletes the Commission entirely** (reason preserved in ActivityLog meta); notifies agents (`COMMISSION_REJECTED`).
- `markSharePaid`: flips a `CommissionShare.paid=true`; when **all** shares paid → Commission `status=PAID`.

#### 2.3.5 Document checklist / compliance — ❌ ABSENT

`Document` exists (type ×9: CNIC_PASSPORT, PROPERTY_DOCUMENT, OWNERSHIP_DOCUMENT, SALE_AGREEMENT, RENTAL_AGREEMENT, PAYMENT_RECEIPT, DEALER_DOCUMENT, CLIENT_DOCUMENT, OTHER; verification ×4; `expiryDate`; polymorphic links). **But:** there is **no required-document checklist and no gate** preventing a deal from reaching `CLOSED_WON` without signed agreements. Documents are audit/reference only. Deal detail shows them read-only.

### 2.4 Contact / Client Management

- **`Client`** is a single undifferentiated entity: `name`, `phone`, `email`, `address`, `notes`. ❌ **There is no buyer/seller/tenant/investor/vendor type discriminator** — role is implied only by what the client is *attached to* (a Lead, a Deal as buyer, etc.).
- **Vendors/suppliers** are modeled as **`Dealer`** (inventory providers): `name`, `contact`, `companyName`, `areaOfOperation`, `defaultSharePct`, optional `User` login (`DealerUser`). Dealers get a scoped portal (their inventory + their deals + their commission shares).
- **De-dup:** `createLead` matches existing Clients by phone/email within the tenant (indexes `(companyId, phone)`, `(companyId, email)`).
- ❌ No household/relationship graph, no contact tags/segments, no communication-preference fields, no marketing-consent/DNC flag.

---

## 3. Primary Workflows & Automation Engine

### 3.1 Lead Routing — ❌ NO ALGORITHM (manual triage)

**Verified across the codebase: there is no automatic lead-routing engine.** No round-robin, no geography/zone assignment, no shark-tank/whale escalation, no load balancing. Assignment is entirely manual:

1. **Agent-created lead** → auto-assigned to the creating agent (`agentId = user.id`).
2. **Office-created lead** (OWNER/ADMIN) → agent chosen from a dropdown, or left `null`.
3. **CSV/portal import** → **all land `agentId = null`** ("Imports land unassigned — admins triage from the leads list").
4. **Manual reassign** (`assignAgent`, gated by `assignLeadsCalendars`) → admin/owner picks an agent; agent receives a `LEAD_ASSIGNED` notification.

On assignment / stage advance, `scheduleAutoFollowUp()` fires (subject to the §2.1.7 guards). The newly built **agent filter** on the leads list (incl. an "Unassigned" bucket, index-backed by `(companyId, agentId, updatedAt)`) is the current triage surface.

> **This is the single largest automation gap and the highest-leverage optimization target.** (See §5.)

### 3.2 Nurturing / Drip — partial (time-based only, not behavior-based)

- **What exists:** the stage-based auto-follow-up **task** cadence (NEW +24h, CONTACTED +48h, INTERESTED +72h) — see §2.1.7. This creates a calendar task for the agent, **not** an automated outbound message.
- ❌ **No behavior-triggered drip.** Listing-view events (e.g., a client opening a shared `/p/[slug]` page) are **not tracked or fed back** into any sequence. There is no email/WhatsApp drip engine, no multi-step sequence builder, no enrollment/exit logic.
- **WhatsApp templates** (`src/lib/whatsapp.ts → TEMPLATES`) exist as **manually triggered** message builders: `newLeadFollowUp`, `propertyDetails`, `siteVisitConfirmation`, `paymentReminder`, `dealUpdate`, `documentRequest`. They produce text for a `wa.me` deep link or a Cloud-API send — agent-initiated, not automated sequences.

### 3.3 Task Management & Trigger-Based Notifications

**Calendar/tasks** — `CalendarEvent` (type ×8: SHOWING, MEETING, FOLLOW_UP, OPEN_HOUSE, PAYMENT_REMINDER, DOCUMENT_REMINDER, RENTAL_RENEWAL, DEAL_CLOSING; status ×4: SCHEDULED, DONE, CANCELLED, MISSED). Completing a SHOWING/MEETING/FOLLOW_UP event updates `Lead.lastContactedAt`.

**Notifications** — `Notification` (type ×9, channel ×4; **only IN_APP rows are produced today**). Trigger points (in-app, via `notify(...)`):

| Trigger (event in code) | Notification type | Recipient |
|---|---|---|
| Lead assigned to an agent | `LEAD_ASSIGNED` | the agent |
| Commission generated (awaiting approval) | `COMMISSION_APPROVAL` | all OWNER/ADMIN |
| Commission approved | `GENERAL` | share-holding agents |
| Commission rejected | `COMMISSION_REJECTED` | share-holding agents |
| (enum reserved) Payment due/overdue, document expiry, visit verify, reminder | `PAYMENT_DUE` / `PAYMENT_OVERDUE` / `DOCUMENT_EXPIRY` / `VISIT_VERIFY` / `REMINDER` | — *(types exist; producers are partial/cron-driven where present)* |

> ⚠️ The escrow-style alert the prompt imagines — "alert an agent when a milestone is missing a signature" — **does not exist**, because there is no signature/checklist state to monitor (see §2.3.5).

### 3.4 Background Job Engine — `src/lib/jobs/**` + `/api/jobs/tick`

Postgres-backed queue (table `Job`). A cron hits `GET/POST /api/jobs/tick` (~1/min), authenticated by a timing-safe `JOBS_TICK_TOKEN`.

**Per-tick sequence:**
1. **Reaper** (`sweepStuckJobs`) — RUNNING rows whose `claimedAt` exceeds a timeout reset to QUEUED (crash recovery).
2. **Trial-expiry sweep** (`sweepExpiredTrials`).
3. **Queue drain** (`runDueJobs`) — fetch `status=QUEUED AND runAt ≤ now`, ordered by `runAt`, cap **20/tick**; atomic claim (where-clause asserts `status=QUEUED`); dispatch to handler; on success → DONE; on failure with `attempts < maxAttempts (3)` → re-QUEUE with **exponential backoff (1m → 2m → 4m)**; else FAILED.
4. **Daily throttled sweeps** (≤1/24h): `purgeOldRows` (Job/AiSuggestion/IdempotencyKey TTL), `sweepWhatsAppTokens`, `sweepWhatsAppTemplateCatalog`.

**Job types** (`JOB_TYPES`): `trial.expire`, `whatsapp.inbound`, `whatsapp.outbound`, `whatsapp.status`, `test.echo`. Webhook-driven jobs carry an `idempotencyKey` (Meta `wamid`) unique per `(type, idempotencyKey)` so retries don't double-process.

### 3.5 Multi-Tenant Scoping (security workflow) — `src/lib/scope.ts`

Every list/detail query is filtered through a scope helper, enforcing both tenant and role:

| Scope | OWNER/ADMIN | AGENT | DEALER |
|---|---|---|---|
| `propertyScope` | all company properties | only properties where they're in `PropertyAgent` | only `dealerId == their dealer` |
| `leadScope` | all company leads | only `agentId == self` | (treated as office: companyId only) |
| `dealScope` | all company deals | deals they're linked to (`DealAgent`) | deals for their dealer's inventory |

Authorization is **capability-based** (`can(role, capability)`, §4.1) for *actions*, and **scope-based** (the above) for *data visibility*.

### 3.6 AI Subsystem — `src/lib/ai/**`

**Gating pipeline (`checkAiBudget`):** (1) `ANTHROPIC_API_KEY` present? (2) `Company.aiEnabled`? (3) plan budget `> 0`? (4) monthly `COUNT(AiSuggestion since month start) < limit`?

**Per-plan monthly budget (`AI_BUDGET`):** `FREE 0 · TRIAL 25 · STARTER 100 · GROWTH 1,000 · PRO ∞`. One AiSuggestion row = one billable call; **cache hits don't count.**

**Run/cache pipeline (`runAi`):** SHA-256 hash of `{system, prompt, inputs}` → look up an AiSuggestion within the freshness window (~30 min default) → on miss, call Claude with the system block marked `cache_control: ephemeral` (prompt caching) → persist row with token accounting.

**Handlers** (`src/lib/ai/handlers/`):

| Handler | Provider / model | Purpose | Cache TTL |
|---|---|---|---|
| `lead-next-action` | Anthropic `claude-opus-4-7` | Suggest the single next action for a lead (markdown, ≤120 words) | ~30 min |
| `lead-reply-draft` | Anthropic `claude-opus-4-7` | Draft a WhatsApp reply for a lead's state (plain text, 2–4 sentences, EN + optional Urdu) | ~60 s |
| `owner-insight` | Anthropic `claude-opus-4-7` | Owner weekly narrative from week-over-week deltas (markdown + "what to do next") | ~6 h |
| `property-copy` | **OpenAI `gpt-4o-mini`** | Generate listing title (≤70 chars) + description (≤90 words) from attributes; JSON out | ~10 min |
| `whatsapp-classify` | Anthropic (direct, no `runAi` cache/budget) | Classify inbound WA message → `{intent, urgency, lead_summary, suggested_pref_type/area/budget}` | none |

### 3.7 Other Integration Mechanics (present)

- **WhatsApp (Meta Cloud API v21.0)** — `wa-business.ts`: `sendWhatsAppText` (≤1,000 chars, only inside Meta's 24h customer-service window), `sendWhatsAppTemplate` (name + language + positional params; TEXT headers only, media headers unsupported), `fetchTemplateCatalog` (paginated, ≤10 pages, mirrored into `WhatsAppTemplate`), `pingWhatsAppToken`. Inbound webhook validates `X-Hub-Signature-256` (HMAC-SHA256 against `WHATSAPP_APP_SECRET`), maps `phone_number_id → Company.whatsappPhoneId`, enqueues one idempotent job per message/status. Access token stored AES-256-GCM-encrypted.
- **Uploads** — `uploads.ts`: `/uploads` root (outside `/public`), 10 MB cap, allow-list of extensions (images, pdf, doc(x), xls(x), csv, txt), `safeName` sanitization, served via authenticated `/api/files/[...]`. ❌ No malware scanning (hook exists, inactive).
- **Public share** — `share.ts`: `newShareSlug()` = ~96-bit base64url token; `/p/[slug]` renders a client-facing property page; media proxied via `/api/public/property-media/{slug}/{mediaId}` (authorized purely by the unguessable slug). ❌ **No view/open tracking** on these pages.
- **Search** — `search.ts`: cross-entity (Properties, Leads, Deals, Clients, Dealers), role-scoped, ≥2 chars, ≤6 hits/type, parallel queries; backed by `pg_trgm` GIN indexes for substring ILIKE.
- **CSV** — `csv.ts` + `/api/export`: RFC-4180 writer/parser; export types = agents, deals, payments, properties, leads, commissions, invoices (gated by `viewCompanyReports`). Lead import maps CSV rows → unassigned leads.
- **Rate limiting** — `rate-limit.ts`: in-process sliding window (Map). ⚠️ Single-process only; needs Redis for PM2 cluster/multi-box.
- **Concurrency** — `concurrency.ts`: `casUpdate` (version-based, throws) + `casUpdateGuarded` (predicate-based, returns bool); used on Property/Payment/Commission. **Idempotency** — `idempotency.ts`: `runOnce(companyId, scope, key, op)` backed by `IdempotencyKey` unique `(companyId, scope, key)`, 7-day TTL.

---

## 4. Reporting & Analytics

### 4.1 RBAC matrix (verbatim — `src/lib/rbac.ts`)

| Capability | SUPER_ADMIN | OWNER | ADMIN | AGENT | DEALER |
|---|:--:|:--:|:--:|:--:|:--:|
| `manageCompanies` | ✓ | | | | |
| `manageUsers` | ✓ | ✓ | ✓ | | |
| `manageProperties` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `assignLeadsCalendars` | ✓ | ✓ | ✓ | | |
| `updateLeadsVisits` | ✓ | ✓ | ✓ | ✓ | |
| `recordDeals` | ✓ | ✓ | ✓ | | |
| `setCommissionRules` | ✓ | ✓ | | | |
| `approveCommission` | ✓ | ✓ | ✓ | | |
| `viewCompanyReports` | ✓ | ✓ | ✓ | | |
| `managePayments` | ✓ | ✓ | ✓ | | |
| `manageDocuments` | ✓ | ✓ | ✓ | ✓ | ✓ |

Reporting visibility is gated by `viewCompanyReports` (OWNER/ADMIN/SUPER_ADMIN). Agents/dealers see only their own scoped dashboards.

### 4.2 Plan limits (verbatim — `src/lib/plans.ts`)

| Plan | Max users | Max properties | Storage (MB) |
|---|--:|--:|--:|
| FREE | 3 | 25 | 100 |
| TRIAL | 5 | 50 | 500 |
| STARTER | 10 | 200 | 1,000 |
| GROWTH | 25 | 1,000 | 5,000 |
| PRO | ∞ | ∞ | 50,000 |

Enforced at write boundary via `canAddUser` / `canAddProperty` (storage tracked but ❌ **not enforced**).

### 4.3 KPIs & metrics that DO exist

**Dashboard metrics — `src/lib/metrics.ts`** (cached 60 s under tag `co:{companyId}:metrics`, invalidated on deal/payment/commission mutation):

| Metric | Definition |
|---|---|
| `salesRevenue(companyId, since?)` | `Σ Sale.salePrice` where Deal `CLOSED_WON` (optionally `closeDate ≥ since`) |
| `monthlyRevenue(companyId, months=6)` | `Σ Sale.salePrice` of CLOSED_WON deals, bucketed by month |
| `commissionTotals(companyId)` | `Σ CommissionShare.amount` grouped by `paid` → `{paid, pending, total}` |
| `outstandingPayments(companyId)` | `due` (PENDING/PARTIAL, not past due) + `overdue` (status OVERDUE **or** PENDING/PARTIAL past `dueDate`) + count |
| `agentLeaderboard(companyId)` | per AGENT: dealsWon (MAIN role, CLOSED_WON), revenue (Σ sale+rent), leads, wonLeads, conversion% = won/leads; sorted by revenue |
| `leadsByStage(companyId)` | COUNT by stage, excl. CLOSED_LOST (pipeline funnel) |
| `inventorySnapshot(companyId)` | Property COUNT by status |
| `payoutSummary(companyId)` | CommissionShare (Commission APPROVED/PAID) → by recipient + by party + totals (paid/pending) |

**Date-range reports — `src/lib/reports.ts`** (scoped by `?from`/`?to`, default month-to-date):

| Report | Definition |
|---|---|
| `monthlySalesVsRentals(range)` | per month: Σ sale.salePrice (SALE wins) vs Σ rental.monthlyRent (RENTAL wins); clamps window to 24 months |
| `leadSourceConversion(range)` | per `LeadSource`: total / won / lost / `conversion% = won/total` (created in window) |
| `funnelDropoff(range)` | cumulative count per stage (excl. CLOSED_LOST) + stage-to-stage `retentionPct` |
| `paymentOverdueAging()` | overdue payments bucketed 1–30 / 31–60 / 61–90 / 90+ days (count + Σ amount) |
| `propertyInventoryAging()` | active listings bucketed ≤30 / 31–60 / 61–90 / 91–180 / 180+ days since `createdAt` — **proxy for days-on-market** |
| `visitVerificationStats(range)` | Showing COUNT by verification status + `verificationRate% = verified/total` |

**Reports page** also computes ad-hoc: overall lead conversion %, lost-lead reasons (by reason / source / agent), lost-deal reasons (by reason / agent), area-wise revenue (top 6), dealer performance, and an optional **AI weekly insight** narrative.

**Role dashboards:** Owner (revenue MoM, commission pending, open deals, overdue, trend, inventory donut, funnel, top-5 agents); Agent (today's tasks, active leads, properties, commission pending, today's calendar); Admin (leads-to-assign, visits-to-verify, docs-to-check, payments-due, today's schedule, commissions awaiting approval, stale leads); Dealer (inventory, deals closed, share earned/pending).

### 4.4 KPIs / capabilities that are ❌ ABSENT

These commonly-expected real-estate analytics are **not implemented** — high-value targets for the optimizing model:

- **GCI (Gross Commission Income)** as a first-class metric — commission *shares* are tracked, but there is no "commission as % of transaction value" / gross-vs-net concept, no GCI-per-agent or GCI forecast.
- **True Days-on-Market** — only aging *buckets* exist; no per-listing DOM figure, no average DOM, no list-to-sale velocity.
- **Forecasting / pipeline projection** — no probability-weighted pipeline, no expected-close-date or revenue forecast from stage distribution.
- **Quota / target attainment** — leaderboard is absolute, not vs. goal.
- **Lead response-time SLA** — stale detection exists; first-response latency does not.
- **CAC / cost-per-lead, marketing spend, ROI by source.**
- **Price-per-unit-area** (PKR/marla), valuation/appreciation trends, price-history analytics.
- **Customer lifetime value / repeat-client analytics.**
- **Lost-deal *value* (financial impact)** — only counts/reasons, not summed lost pipeline value.
- **Segmented funnels** (by price tier, area, bedrooms, agent cohort).

---

## 5. Critical Pain Points & Optimization Areas

### 5.1 Structural bottlenecks (from the code, ranked by leverage)

1. **Manual lead routing (no engine).** Imports and office-created leads pile up unassigned; triage is human. *Impact:* slow first response, uneven agent load, leads going cold (the health engine flags them but nothing acts). **The single biggest automation gap.**
2. **Manual listing entry; no portal ingest.** Every Zameen/Graana/OLX listing is re-keyed. `importSource` records provenance but there's no inbound listing sync. *Impact:* data-entry labor, duplication, staleness.
3. **No behavior signals.** Public `/p/[slug]` share pages have no view/open tracking, so "client viewed the listing" — the richest buying signal — never reaches scoring, health, or any sequence.
4. **No drip/sequence engine.** Nurture is a calendar reminder for the agent to act manually; there's no automated multi-step WhatsApp/email sequence with enrollment/exit.
5. **No compliance/checklist gate on deals.** Deals can reach CLOSED_WON with no signed agreement, no required documents, no approval gate; `agreement` status is a cosmetic label. *Impact:* audit/compliance risk, missing-paperwork leakage.
6. **Free-form deal & document state.** Any status→any status; no enforced milestone order; documents are reference-only.
7. **Email + SMS channels stubbed but inert.** `NotificationChannel.EMAIL/SMS` enums exist with no delivery provider — every alert is in-app, so a logged-out owner/agent misses time-sensitive events (overdue payment, approval needed).
8. **In-process rate limiter & 60 s metrics cache** — fine single-process, but a scaling cliff under PM2 cluster / multi-node (needs Redis).
9. **Single undifferentiated `Client`** — no buyer/seller/tenant/investor typing, no segments/tags, no consent/DNC fields — limits targeting and compliance.
10. **No price-history / temporal data** — `version` bumps but prior values are discarded; analytics on price changes / DOM are impossible to compute retroactively.

### 5.2 Where AI / automation / UX redesign pays off most

| Opportunity | Mechanism (leveraging what's already here) | Expected effect |
|---|---|---|
| **Auto lead routing** | Add a routing strategy (round-robin / area-match via existing `prefArea`+agent coverage / load-aware) firing on `createLead` + import; reuse `notify(LEAD_ASSIGNED)` | Faster first response, balanced load, fewer cold leads |
| **Listing-view tracking → live scoring** | Instrument `/p/[slug]`; emit a job; feed a "viewed listing (N×)" signal into `lead-score` and `lead-health`; trigger an agent nudge | Surfaces hot intent the system is currently blind to |
| **Behavior-triggered WhatsApp drip** | Build a sequence engine on the existing job queue + `WhatsAppTemplate` catalog + `TEMPLATES`; enroll on stage/inactivity/view; respect Meta 24h window (template vs free-form) | Automated nurture without agent toil |
| **AI inbound triage at scale** | `whatsapp-classify` already extracts intent/urgency/budget/area — wire it to auto-create/route a lead and draft a `lead-reply-draft` reply | Near-zero-touch lead capture from WhatsApp |
| **OCR / doc intake** | Parse CNIC / agreements / receipts on upload (the `DocumentType` taxonomy already exists) to auto-populate clients/payments and build a real checklist | Kills manual data entry; enables a compliance gate |
| **Deal milestone gate + alerts** | Make `agreement`/document state a real precondition for CLOSED_WON; emit `DOCUMENT_REMINDER`/`VISIT_VERIFY` notifications (enums already defined) | Compliance, fewer missing-paperwork escapes |
| **GCI / DOM / forecasting analytics** | Add GCI per agent/source, per-listing DOM (needs a sold-date capture already present via `closeDate`), and a stage-weighted pipeline forecast | Strategic visibility the dashboards lack |
| **Email/SMS delivery** | Implement an `EMAIL`/`SMS` channel producer (the `NotificationChannel` enum + `Job` queue are ready) so critical alerts reach off-app users | Time-sensitive alerts actually land |
| **Duplicate-listing / dedup AI** | Extend the existing client phone/email dedup to fuzzy listing dedup (trigram already available) | Cleaner inventory |
| **Redis-backed rate limit + cache** | Swap the in-process `STORE`/metrics cache for Redis | Removes the horizontal-scaling cliff |

---

## Appendix A — Enum Catalog (verbatim)

- **Role:** SUPER_ADMIN, OWNER, ADMIN, AGENT, DEALER
- **CompanyPlan:** FREE, TRIAL, STARTER, GROWTH, PRO · **BillingStatus:** TRIAL, ACTIVE, GRACE, PAST_DUE, CANCELLED
- **PropertyType:** RESIDENTIAL, COMMERCIAL, PLOT, APARTMENT, VILLA, SHOP, OFFICE · **AreaUnit:** SQFT, SQM, SQYD, MARLA, KANAL · **ListingType:** SALE, RENT, BOTH
- **PropertyStatus:** AVAILABLE, RESERVED, UNDER_NEGOTIATION, RENTED, SOLD, INACTIVE, PENDING_VERIFICATION · **MediaKind:** PHOTO, VIDEO, FLOOR_PLAN, BROCHURE
- **LeadStage:** NEW, CONTACTED, INTERESTED, SITE_VISIT, PROPERTY_SHOWN, NEGOTIATION, TOKEN_BOOKING, PAYMENT, CLOSED_WON, CLOSED_LOST · **LeadSource:** REFERRAL, WALK_IN, SOCIAL_MEDIA, PORTAL, CALL, REPEAT_CLIENT, OTHER · **LeadScoreOverride:** HOT, WARM, COLD
- **CalendarEventType:** SHOWING, MEETING, FOLLOW_UP, OPEN_HOUSE, PAYMENT_REMINDER, DOCUMENT_REMINDER, RENTAL_RENEWAL, DEAL_CLOSING · **CalendarEventStatus:** SCHEDULED, DONE, CANCELLED, MISSED
- **InterestLevel:** HIGH, MEDIUM, LOW, NONE · **VerificationStatus:** PENDING, VERIFIED, REJECTED, FLAGGED · **GpsLogKind:** IN, OUT
- **DealType:** SALE, RENTAL · **DealStatus:** DRAFT, NEGOTIATION, TOKEN, BOOKED, AGREEMENT, CLOSED_WON, CLOSED_LOST · **AgreementStatus:** NONE, DRAFT, SIGNED, COMPLETED · **DealAgentRole:** MAIN, CO_AGENT
- **PaymentType:** TOKEN, BOOKING, DOWN_PAYMENT, INSTALMENT, RENT, DEPOSIT, COMMISSION · **PaymentStatus:** PENDING, PARTIAL, PAID, OVERDUE · **InvoiceStatus:** DRAFT, ISSUED, PAID, CANCELLED
- **CommissionStatus:** DRAFT, PENDING_APPROVAL, APPROVED, PAID · **CommissionParty:** AGENT_MAIN, COMPANY, AGENT_OTHER, DEALER · **FallbackParty:** MAIN, COMPANY
- **DocumentType:** CNIC_PASSPORT, PROPERTY_DOCUMENT, OWNERSHIP_DOCUMENT, SALE_AGREEMENT, RENTAL_AGREEMENT, PAYMENT_RECEIPT, DEALER_DOCUMENT, CLIENT_DOCUMENT, OTHER
- **NotificationType:** REMINDER, PAYMENT_DUE, PAYMENT_OVERDUE, COMMISSION_APPROVAL, COMMISSION_REJECTED, VISIT_VERIFY, DOCUMENT_EXPIRY, LEAD_ASSIGNED, GENERAL · **NotificationChannel:** IN_APP, EMAIL, SMS, WHATSAPP *(only IN_APP produced)*
- **JobStatus:** QUEUED, RUNNING, DONE, FAILED · **AiSuggestionType:** LEAD_NEXT_ACTION, LEAD_REPLY_DRAFT, WHATSAPP_INTENT, OWNER_WEEKLY_INSIGHT, PROPERTY_COPY

## Appendix B — Constants quick-reference

| Constant | Value | File |
|---|---|---|
| Lead band thresholds | HOT ≥ 70, WARM ≥ 40, else COLD | `lib/lead-score.ts` |
| Recency bonus / quiet penalty | ≤7 d: +8 · >14 d: −6 | `lib/lead-score.ts` |
| Health URGENT multiplier | `staleAfter × 1.5` | `lib/lead-health.ts` |
| Follow-up cadence | NEW 24h · CONTACTED 48h · INTERESTED 72h | `lib/lead-followups.ts` |
| Match: type/area/in-budget | +30 each (cap 100) | `lib/lead-matching.ts` |
| Sale-intent budget threshold | ≥ 10,000,000 PKR | `lib/lead-matching.ts` |
| CommissionRule defaults | main 50 / company 25 / other 25 / dealer 0, fallback MAIN | `schema.prisma` |
| AI model / tokens | `claude-opus-4-7`, max_tokens 800, adaptive thinking | `lib/ai/client.ts` |
| AI budget / month | FREE 0 · TRIAL 25 · STARTER 100 · GROWTH 1,000 · PRO ∞ | `lib/ai/budget.ts` |
| Property-copy model | OpenAI `gpt-4o-mini` | `lib/ai/openai.ts` |
| Jobs per tick / retries / backoff | 20 / 3 / 1m→2m→4m | `lib/jobs/runner.ts` |
| Session | NextAuth v5 JWT, 8 h, refresh 1 h | `src/auth.ts` |
| Upload limits | 10 MB, extension allow-list, no malware scan | `lib/uploads.ts` |
| Idempotency / rate-limit | `IdempotencyKey` 7-day TTL · in-process sliding window | `lib/idempotency.ts`, `lib/rate-limit.ts` |

---

*End of blueprint. All figures verified against source at the documented paths; absences are explicit. Currency is PKR throughout; rental figures are monthly, not annualized.*
