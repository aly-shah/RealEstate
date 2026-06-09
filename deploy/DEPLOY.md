# Deploying Proptimizr CRM to a VPS

Target: **crm.proptimizr.com**, served by **nginx → PM2 → Next.js**, backed by **PostgreSQL**.

## 0. Before you run anything

Point DNS for the subdomain at your server:

```
A    crm.proptimizr.com    ->  <your VPS public IP>
```

TLS (Let's Encrypt) only succeeds once this resolves to the box.

## 1. One command

SSH into the VPS as a sudo user and run:

```bash
curl -fsSL https://raw.githubusercontent.com/aly-shah/RealEstate/main/deploy/setup.sh -o setup.sh
sudo DOMAIN=crm.proptimizr.com LE_EMAIL=you@example.com bash setup.sh
```

That installs Node 22, PostgreSQL, PM2 and nginx; creates the database; clones
the repo to `/var/www/proptimizr-crm`; builds; seeds demo data; starts the app
under PM2 on port 3000; writes the nginx vhost; and obtains an HTTPS cert.

## 2. The port that's already in use

The script targets port **3000** by default and frees it for you:

- If a **PM2** app is on that port, it's stopped and removed automatically.
- If `STOP_PM2_APP=<name>` is set, that PM2 app is stopped first.
- If a **non-PM2** process holds the port, the script stops and tells you to
  either re-run with `FORCE_FREE_PORT=yes` (kills it) or pick another port.

Examples:

```bash
# disable a known old PM2 app, then deploy
sudo DOMAIN=crm.proptimizr.com STOP_PM2_APP=old-app bash setup.sh

# force-free whatever is on the port
sudo DOMAIN=crm.proptimizr.com FORCE_FREE_PORT=yes bash setup.sh

# or just run the CRM on a different port (nginx still serves the domain)
sudo DOMAIN=crm.proptimizr.com APP_PORT=3100 bash setup.sh
```

## 3. Configurable env vars

| Var | Default | Purpose |
|-----|---------|---------|
| `DOMAIN` | `crm.proptimizr.com` | server_name + AUTH_URL |
| `APP_PORT` | `3000` | port the app listens on (behind nginx) |
| `APP_DIR` | `/var/www/proptimizr-crm` | install location |
| `DB_NAME` / `DB_USER` / `DB_PASS` | `proptimizr_crm` / `proptimizr` / random | Postgres |
| `SEED` | `yes` | seed demo data on first deploy |
| `TLS` | `yes` | run certbot |
| `LE_EMAIL` | `admin@$DOMAIN` | Let's Encrypt contact |
| `STOP_PM2_APP` | — | existing PM2 app to stop first |
| `FORCE_FREE_PORT` | `no` | kill a non-PM2 process on the port |
| `NODE_MAJOR` | `22` | Node major version |

The script is **idempotent**: re-running pulls the latest code, rebuilds, and
reuses the existing database and `AUTH_SECRET` (no data loss, no rotated secret).

## 4. Day-to-day

```bash
pm2 status proptimizr-crm        # process state
pm2 logs proptimizr-crm          # tail logs
pm2 reload proptimizr-crm        # zero-downtime restart

# deploy a new commit
cd /var/www/proptimizr-crm && git pull && npm ci && npx prisma db push && npm run build && pm2 reload proptimizr-crm
```

### Schema migrations on a hot database

`prisma db push` rebuilds indexes without `CONCURRENTLY`, which briefly
blocks writes on the affected table. For changes that touch large or
write-heavy tables (`ActivityLog`, `Payment`, anything you watch grow on
`/admin/jobs`), run the matching SQL script under `deploy/migrations/`
**before** the `prisma db push`, so the indexes are already in place and
Prisma sees them as a no-op:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f deploy/migrations/2026-05-24-index-refinement.sql

# then the regular deploy — db push will recognise the indexes and skip
npx prisma db push
```

Apply the same way for any later index added to a hot table, e.g. the
Lead agent-filter composite:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f deploy/migrations/2026-06-10-lead-agent-index.sql
```

Each script is idempotent (`IF [NOT] EXISTS`) so a re-run on a partially
applied database is safe — and a no-op once `prisma db push` has already
created the index under the same name.

## 5. Notes

- The app trusts the proxy (`AUTH_TRUST_HOST=true`) and nginx forwards
  `X-Forwarded-Proto`, so Auth.js builds correct `https://crm.proptimizr.com`
  callback URLs and sets secure cookies.
- Uploads are written to `/var/www/proptimizr-crm/uploads` (gitignored); nginx
  allows up to 12 MB bodies. Back this folder up, or swap `src/app/api/upload`
  + `src/app/api/files` for S3 for durability.
- Schema is applied with `prisma db push` (no migration files yet). Generate
  migrations later with `prisma migrate dev` if you want versioned schema.
- This ships with **seeded demo data and demo logins** — change/remove them and
  create real accounts before going live.
