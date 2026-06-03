# Proptimizr CRM — Backup & Restore

This document covers everything an ops person needs to **back up**, **verify**, and **restore** a Proptimizr CRM deployment. The single source of truth is `deploy/backup.sh` in this repo.

## What's backed up

| Asset | Source | Why |
|-------|--------|-----|
| **PostgreSQL database** | `pg_dump` of the entire CRM DB | All tenants, users, properties, deals, payments, commissions, activity log, etc. |
| **Uploads directory** | `tar -czf` of `${APP_DIR}/uploads/` | Every property photo, document, brochure, signed agreement — these are not in the DB. |

`AUTH_SECRET`, the `.env` file, and the codebase are **not** backed up — they're in `.env` (don't commit) and `git` respectively. Recovery assumes you can `git clone` the repo and regenerate the `.env` (or pull it from a secrets manager).

## Retention plan

| Tier | Default count | Trigger |
|------|---------------|---------|
| Daily | 14 (≈ 2 weeks) | Every run |
| Weekly | 8 (≈ 2 months) | Sundays |
| Monthly | 6 (≈ 6 months) | 1st of each month |

Override via env vars: `DAILY_KEEP=30 WEEKLY_KEEP=12 MONTHLY_KEEP=12 /usr/local/sbin/proptimizr-backup`.

## Install (one-time, as root on the VPS)

```bash
# 1. Copy the script somewhere on PATH.
cp /var/www/proptimizr-crm/deploy/backup.sh /usr/local/sbin/proptimizr-backup
chmod +x /usr/local/sbin/proptimizr-backup

# 2. Smoke-test it (creates the backup dir + writes today's archives).
/usr/local/sbin/proptimizr-backup

# 3. Install the cron entry (02:15 UTC daily).
(crontab -l 2>/dev/null; echo "15 2 * * * /usr/local/sbin/proptimizr-backup >> /var/log/proptimizr-backup.log 2>&1") | crontab -

# 4. Verify the cron entry is there.
crontab -l | grep proptimizr-backup
```

The script reads `DATABASE_URL` from `${APP_DIR}/.env` automatically (`APP_DIR` defaults to `/var/www/proptimizr-crm`).

## Where backups live

```
/var/backups/proptimizr-crm/
├── daily/
│   ├── db-2026-05-24T02-15-00Z.sql.gz
│   ├── uploads-2026-05-24T02-15-00Z.tar.gz
│   └── ...
├── weekly/
│   └── (Sunday copies)
└── monthly/
    └── (first-of-month copies)
```

Override the root with `BACKUP_DIR=/mnt/external/backups`.

## Off-site copy (recommended)

The on-VPS backups are useless if the VPS itself burns down. Pair the cron job with an off-site sync. Pick one:

```bash
# Option A: rclone to S3 / B2 / Drive (one-time setup: `rclone config`)
echo "30 2 * * * rclone sync /var/backups/proptimizr-crm remote:proptimizr-backups >> /var/log/proptimizr-rclone.log 2>&1" \
  | crontab -

# Option B: rsync to a second box over SSH
echo "30 2 * * * rsync -az --delete /var/backups/proptimizr-crm/ backup@host:/srv/proptimizr-backups/" \
  | crontab -

# Option C: restic to any backend (handles encryption + dedup automatically)
echo "30 2 * * * restic -r b2:proptimizr-bucket backup /var/backups/proptimizr-crm" \
  | crontab -
```

Whatever you pick, **monitor it** — a backup nobody checks is a backup that's already broken. A simple "did today's archive show up?" Slack ping is enough.

## Verify a backup (do this monthly)

```bash
# 1. Inspect the latest db dump — should print real SQL.
gunzip -c /var/backups/proptimizr-crm/daily/db-*.sql.gz | head -50

# 2. List uploads inside the tarball.
tar -tzf /var/backups/proptimizr-crm/daily/uploads-*.tar.gz | head

# 3. Full restore-to-throwaway-database (the only check that really counts).
sudo -u postgres createdb proptimizr_crm_restore_test
gunzip -c /var/backups/proptimizr-crm/daily/db-*.sql.gz \
  | sudo -u postgres psql -d proptimizr_crm_restore_test
sudo -u postgres psql -d proptimizr_crm_restore_test -c 'SELECT COUNT(*) FROM "User";'
sudo -u postgres dropdb proptimizr_crm_restore_test
```

If step 3 fails, your backups are broken — fix before you need them.

## Restore — disaster recovery

Assume the VPS is gone, you have a fresh Ubuntu host, and a copy of the latest backup files.

### 1. Re-provision the app

```bash
# Same as a fresh install — see deploy/DEPLOY.md.
sudo DOMAIN=crm.proptimizr.com LE_EMAIL=you@example.com bash setup.sh
```

`setup.sh` is idempotent. Stop it before it seeds demo data if your backup contains real data:

```bash
sudo DOMAIN=crm.proptimizr.com SEED=no bash setup.sh
```

This installs Node + Postgres + PM2 + nginx and writes a fresh `.env` (with a NEW `AUTH_SECRET`). **Replace `AUTH_SECRET` with the original from your offsite secrets store before restoring** — otherwise every existing user's session cookie becomes invalid (forces a re-login; not data loss, just friction), AND every stored `Company.whatsappAccessToken` becomes undecryptable (outbound WhatsApp stops working tenant-wide until owners re-paste — see [`ROTATION.md`](ROTATION.md) for the bulk re-encrypt script).

### 2. Restore the database

```bash
APP_DIR=/var/www/proptimizr-crm
DB_BACKUP=/path/to/db-2026-05-24T02-15-00Z.sql.gz

# Stop the app while we swap data.
pm2 stop proptimizr-crm

# Wipe the freshly-seeded database; restore from backup.
DB_URL="$(grep -E '^DATABASE_URL=' "$APP_DIR/.env" | head -1 | cut -d= -f2- | tr -d '"')"
gunzip -c "$DB_BACKUP" | psql "$DB_URL"

# Sanity check.
psql "$DB_URL" -c 'SELECT COUNT(*) FROM "Company";'
```

The dump was taken with `--clean --if-exists`, so it drops any pre-existing tables and recreates them before loading data — safe even on a non-empty DB.

### 3. Restore uploads

```bash
UP_BACKUP=/path/to/uploads-2026-05-24T02-15-00Z.tar.gz

# Remove the empty/seeded uploads dir, untar over the parent.
rm -rf "$APP_DIR/uploads"
tar -xzf "$UP_BACKUP" -C "$APP_DIR"
chown -R www-data:www-data "$APP_DIR/uploads" || true

# Verify.
find "$APP_DIR/uploads" -type f | wc -l
```

### 4. Bring the app back

```bash
pm2 start proptimizr-crm
pm2 logs proptimizr-crm --lines 40
curl -fsS https://crm.proptimizr.com/login >/dev/null && echo "OK"
```

Sign in with any pre-disaster account — if you replaced `AUTH_SECRET` in step 1, cookies from before the disaster are no longer valid; users will need to sign in again. That's expected.

## Single-table restore (when you only need one thing back)

```bash
# Extract just one table from the dump (handy for "I accidentally deleted a company").
gunzip -c db-2026-05-24T02-15-00Z.sql.gz \
  | sed -n '/^COPY public."Company"/,/^\\\.$/p' \
  > company-only.sql

# Inspect first, then load into a throwaway DB and use psql to copy the rows.
```

For non-trivial point-in-time restores, prefer a logical replication slot or a managed Postgres with PITR — `pg_dump` is for "I lost everything" recovery, not for "I lost one row five minutes ago".

## Backup log

The cron entry writes to `/var/log/proptimizr-backup.log`. Rotate it:

```bash
cat <<'EOF' > /etc/logrotate.d/proptimizr-backup
/var/log/proptimizr-backup.log {
  weekly
  rotate 8
  compress
  missingok
  notifempty
  copytruncate
}
EOF
```

## What this does NOT cover (yet)

- **PITR** (point-in-time recovery via WAL archiving). The current dump-based approach has a window of up to 24h of potential loss. If that's unacceptable, switch to a managed Postgres with continuous archiving — the schema, app code, and uploads strategy stay the same.
- **Encryption at rest** of the backup files. If `$BACKUP_DIR` is on a shared disk, wrap the script with `gpg --encrypt` or use `restic` (encryption by default).
- **Backup of `.env` / `AUTH_SECRET`**. Store these in a secrets manager (1Password, Bitwarden, AWS Secrets Manager) — don't commit, don't tar with the DB.
