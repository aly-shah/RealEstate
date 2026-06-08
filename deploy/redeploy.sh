#!/usr/bin/env bash
#
# Proptimizr CRM — redeploy on the VPS. Pulls latest main, installs deps,
# pushes schema changes, builds, and (re)starts the PM2 process. Idempotent.
#
# Security: the app runs as the unprivileged user $APP_USER (default
# "proptimizr"), NOT root — so an app-level RCE can't reach root. Git runs as
# the invoking user (root, via CI, which holds the repo credentials); the
# build + PM2 steps drop privileges to $APP_USER, who owns $APP_DIR.
#
# Invoked by .github/workflows/deploy.yml over SSH (as root), or by hand:
#   sudo bash deploy/redeploy.sh
#
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/RealEstate}"
APP_USER="${APP_USER:-proptimizr}"
BRANCH="${BRANCH:-main}"

log() { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }

cd "$APP_DIR"

# --- Git (runs as the invoking user; root holds the fetch credentials) -------
# safe.directory lets root operate inside the $APP_USER-owned checkout without
# tripping git's dubious-ownership guard.
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
log "Fetching latest from origin/$BRANCH"
git fetch --depth 1 origin "$BRANCH"
git reset --hard "origin/$BRANCH"

# Keep the whole tree owned by the unprivileged app user after the git write.
if [ "$(id -un)" = "root" ]; then
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
fi

# --- Build + (re)start, as the unprivileged app user -------------------------
# `pm2 startOrReload <config>` starts the app if it isn't running and reloads
# it otherwise — idempotent, and it reads the app name from ecosystem.config.cjs
# (no APP_NAME guessing, which historically drifted promptzer- vs proptimizr-).
# Steps are inlined into one shell string so they survive the sudo boundary
# (exported bash functions don't).
STEPS="cd '$APP_DIR' \
  && echo '▸ Installing dependencies'      && npm ci \
  && echo '▸ Applying schema'              && npx prisma generate && npx prisma db push --skip-generate --accept-data-loss \
  && echo '▸ Building Next.js'             && npm run build \
  && echo '▸ Starting/reloading PM2'       && pm2 startOrReload ecosystem.config.cjs --update-env && pm2 save"

if [ "$(id -un)" = "$APP_USER" ]; then
  bash -lc "$STEPS"
else
  log "Dropping to $APP_USER for build + PM2"
  sudo -u "$APP_USER" -H bash -lc "$STEPS"
fi

log "Done · $(date -Is)"
