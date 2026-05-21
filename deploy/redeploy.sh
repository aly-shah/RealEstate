#!/usr/bin/env bash
#
# promptzer CRM — redeploy on the VPS. Pulls latest main, installs deps,
# pushes schema changes, builds, and reloads the PM2 process. Idempotent.
#
# Usually invoked by .github/workflows/deploy.yml over SSH, but you can also
# run it by hand:  sudo APP_DIR=/var/www/RealEstate bash deploy/redeploy.sh
#
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/RealEstate}"
APP_NAME="${APP_NAME:-promptzer-crm}"
BRANCH="${BRANCH:-main}"

log() { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }

cd "$APP_DIR"

log "Fetching latest from origin/$BRANCH"
git fetch --depth 1 origin "$BRANCH"
git reset --hard "origin/$BRANCH"

log "Installing dependencies"
npm ci

log "Applying schema (no-op if unchanged)"
npx prisma generate
npx prisma db push --skip-generate

log "Building Next.js"
npm run build

log "Reloading PM2 process '$APP_NAME'"
pm2 reload "$APP_NAME" --update-env || pm2 start ecosystem.config.cjs --update-env
pm2 save

log "Done · $(date -Is)"
