#!/usr/bin/env bash
#
# Proptimizr CRM — daily backup. Dumps Postgres + tarballs the uploads dir
# under a date-stamped name, then prunes old backups per the retention plan
# below. Designed for a single-VPS deploy (the same machine that runs the app
# and the DB). Idempotent — safe to re-run any time.
#
# Install (one-time, as root):
#   cp deploy/backup.sh /usr/local/sbin/proptimizr-backup
#   chmod +x /usr/local/sbin/proptimizr-backup
#   echo "15 2 * * * /usr/local/sbin/proptimizr-backup >> /var/log/proptimizr-backup.log 2>&1" \
#     | crontab -
#
# Override via env vars (see "Config" below). On servers that pre-date the
# rename, set APP_DIR/BACKUP_DIR explicitly to keep targeting the old paths
# rather than letting the new defaults move things around silently.
#
# Retention (default):
#   - 14 most recent daily backups
#   - 8 Sunday backups (weekly archive)
#   - 6 first-of-month backups (monthly archive)
# Older files are deleted to keep disk use bounded.
#
set -euo pipefail

# ─────────────────────────── Config (override via env) ───────────────────────────
APP_DIR="${APP_DIR:-/var/www/proptimizr-crm}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/proptimizr-crm}"
UPLOADS_DIR="${UPLOADS_DIR:-${APP_DIR}/uploads}"

DAILY_KEEP="${DAILY_KEEP:-14}"
WEEKLY_KEEP="${WEEKLY_KEEP:-8}"
MONTHLY_KEEP="${MONTHLY_KEEP:-6}"

# Database connection: derived from APP_DIR/.env if not provided directly.
# pg_dump accepts a URL via -d.
DATABASE_URL="${DATABASE_URL:-}"
if [ -z "$DATABASE_URL" ] && [ -f "$APP_DIR/.env" ]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' "$APP_DIR/.env" | head -1 | cut -d= -f2- | tr -d '"' || true)"
fi
if [ -z "$DATABASE_URL" ]; then
  echo "FATAL: DATABASE_URL not set and not findable in $APP_DIR/.env" >&2
  exit 1
fi

TODAY="$(date -u +%Y-%m-%d)"
DOW="$(date -u +%u)"           # 1=Mon ... 7=Sun
DOM="$(date -u +%d)"
TS="$(date -u +%Y-%m-%dT%H-%M-%SZ)"

log() { printf "\n[%s] %s\n" "$(date -Is)" "$*"; }

mkdir -p "$BACKUP_DIR"/{daily,weekly,monthly}

# ─────────────────────────── Database dump ───────────────────────────
DB_FILE="$BACKUP_DIR/daily/db-${TS}.sql.gz"
log "Dumping Postgres → $DB_FILE"
# --clean + --if-exists makes the dump self-contained: restoring it drops
# existing objects first. -Fp = plain SQL so you can grep / inspect.
pg_dump --clean --if-exists --no-owner --no-privileges -d "$DATABASE_URL" \
  | gzip -9 > "$DB_FILE"
log "DB dump size: $(du -h "$DB_FILE" | cut -f1)"

# ─────────────────────────── Uploads tarball ───────────────────────────
UP_FILE="$BACKUP_DIR/daily/uploads-${TS}.tar.gz"
if [ -d "$UPLOADS_DIR" ]; then
  log "Archiving uploads → $UP_FILE"
  # -C avoids embedding the absolute path; restore unpacks under whichever
  # directory you cd into.
  tar -czf "$UP_FILE" -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")"
  log "Uploads size: $(du -h "$UP_FILE" | cut -f1)"
else
  log "Uploads dir not found ($UPLOADS_DIR) — skipping"
fi

# ─────────────────────────── Promote weekly / monthly archives ───────────────────────────
if [ "$DOW" = "7" ]; then
  log "Sunday — copying to weekly/"
  cp -p "$DB_FILE" "$BACKUP_DIR/weekly/"
  [ -f "$UP_FILE" ] && cp -p "$UP_FILE" "$BACKUP_DIR/weekly/"
fi
if [ "$DOM" = "01" ]; then
  log "First of month — copying to monthly/"
  cp -p "$DB_FILE" "$BACKUP_DIR/monthly/"
  [ -f "$UP_FILE" ] && cp -p "$UP_FILE" "$BACKUP_DIR/monthly/"
fi

# ─────────────────────────── Retention ───────────────────────────
# Keep the N newest files per tier. ls -t orders newest-first; tail -n +(N+1)
# drops the first N and prints the rest, which we delete.
prune() {
  local dir="$1" keep="$2"
  if [ ! -d "$dir" ]; then return; fi
  ls -1t "$dir" 2>/dev/null | tail -n +"$((keep + 1))" | while read -r f; do
    log "Pruning $dir/$f"
    rm -f "$dir/$f"
  done
}
# Each tier holds two file families (db + uploads), so keep 2× the count.
prune "$BACKUP_DIR/daily"   "$((DAILY_KEEP * 2))"
prune "$BACKUP_DIR/weekly"  "$((WEEKLY_KEEP * 2))"
prune "$BACKUP_DIR/monthly" "$((MONTHLY_KEEP * 2))"

log "Backup complete."
