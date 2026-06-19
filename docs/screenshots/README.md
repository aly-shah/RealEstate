# Screenshots — capture guide

This folder is the home for product screenshots referenced by
`docs/CRM_DOCUMENTATION.md`. **Authenticated screenshots were not auto-captured**
(the app requires login and there's no headless-auth pipeline in this repo), so
this is a precise checklist to populate the folder consistently — by hand or with
a browser-automation tool (Playwright/Puppeteer logged in via the steps below).

## How to capture

1. Log in at `https://crm.proptimizr.com/login` (or a local instance) as the role
   noted per screen.
2. Visit each route, full-page screenshot, save to this folder with the suggested
   filename (PNG, ~1440px wide for desktop; add `-mobile` variants at ~390px for
   the agent/portal views).
3. For automation, after login persist the session cookie and iterate the routes
   below. Detail pages (`[id]`) need a real record id from the seeded data.

> Tip: the **public** screens (portal, property page, CNIC verify) don't need a
> login — they need a valid token/slug. Generate one from a deal/client/property.

## Screen checklist

| # | Filename | Route | Role | Notes |
|---|---|---|---|---|
| 1 | `01-login.png` | `/login` | — | Auth screen |
| 2 | `02-dashboard-owner.png` | `/dashboard` | OWNER | KPI cards + charts |
| 3 | `03-dashboard-agent.png` | `/dashboard` | AGENT | + mobile bottom nav (`-mobile`) |
| 4 | `04-properties-list.png` | `/properties` | OWNER | Filters, table |
| 5 | `05-property-detail.png` | `/properties/[id]` | OWNER | Media, deals, agents |
| 6 | `06-map.png` | `/map` | OWNER | Leaflet map |
| 7 | `07-leads-list.png` | `/leads` | OWNER | Scores, filters, routing |
| 8 | `08-lead-detail.png` | `/leads/[id]` | OWNER | Score panel, AI brief, consent, portal link, WhatsApp send |
| 9 | `09-leads-import.png` | `/leads/import` | OWNER | CSV import |
| 10 | `10-deals-list.png` | `/deals` | OWNER | |
| 11 | `11-deal-detail.png` | `/deals/[id]` | OWNER | Checklist, forecast/GCI, close-likelihood, contract panel, **Documents pack** |
| 12 | `12-deal-documents-section.png` | `/deals/[id]` | OWNER | Crop of the Agreement pack list |
| 13 | `13-sequences-list.png` | `/sequences` | OWNER | Overview stats + cards |
| 14 | `14-sequence-builder.png` | `/sequences/[id]` | OWNER | Timeline, currently-nurturing |
| 15 | `15-whatsapp-inbox.png` | `/whatsapp` | OWNER | |
| 16 | `16-calendar.png` | `/calendar` | AGENT | |
| 17 | `17-visits.png` | `/visits` | AGENT | GPS check-in/verification |
| 18 | `18-commissions.png` | `/commissions` | OWNER | |
| 19 | `19-invoices.png` | `/invoices` | OWNER | |
| 20 | `20-payments.png` | `/payments` | OWNER | Aging, reminders |
| 21 | `21-agents.png` | `/agents` | OWNER | |
| 22 | `22-dealers.png` | `/dealers` | OWNER | |
| 23 | `23-documents.png` | `/documents` | OWNER | Filters, viewer entry |
| 24 | `24-document-viewer.png` | `/documents/[id]` | OWNER | Preview / redirect |
| 25 | `25-reports.png` | `/reports` | OWNER | All report charts incl. weighted forecast |
| 26 | `26-activity.png` | `/activity` | OWNER | Audit trail + charts |
| 27 | `27-notifications.png` | `/notifications` | AGENT | |
| 28 | `28-settings.png` | `/settings` | OWNER | All panels |
| 29 | `29-settings-whatsapp-qr.png` | `/settings` | OWNER | QR link panel (connected + test send) |
| 30 | `30-admin-companies.png` | `/admin/companies` | SUPER_ADMIN | |
| 31 | `31-admin-jobs.png` | `/admin/jobs` | SUPER_ADMIN | Job queue |
| 32 | `32-generated-agreement.png` | `/deal-documents/[id]/agreement` | OWNER | Printable doc + inline editor |
| 33 | `33-generated-sale-deed.png` | `/deal-documents/[id]/sale-deed` | OWNER | |
| 34 | `34-portal.png` | `/portal/[token]` | public | Shortlist, booking, payments |
| 35 | `35-public-property.png` | `/p/[slug]` | public | Shareable listing |
| 36 | `36-cnic-verify.png` | `/verify-identity/[token]` | public | Mobile CNIC scanner (`-mobile`) |

## Naming
`NN-area-detail.png`; add `-mobile` for phone-width captures. Keep them in this
folder so the main doc can reference `docs/screenshots/<file>` directly.
