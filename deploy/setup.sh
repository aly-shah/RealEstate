#!/usr/bin/env bash
#
# Proptimizr Real Estate CRM — one-shot VPS deploy (Ubuntu/Debian).
# Installs Node + PostgreSQL + PM2 + nginx, clones the repo, builds, seeds,
# frees the target port, and serves the app at $DOMAIN with HTTPS.
#
# Usage (run as root):
#   curl -fsSL https://raw.githubusercontent.com/aly-shah/RealEstate/main/deploy/setup.sh -o setup.sh
#   sudo DOMAIN=crm.proptimizr.com LE_EMAIL=you@example.com bash setup.sh
#
# Re-running is safe: it pulls latest, rebuilds, and reuses existing DB/.env.
#
# Upgrading an old deployment that used `promptzer-*` paths/process names?
# Set the legacy values explicitly so the script keeps targeting them:
#   APP_DIR=/var/www/promptzer-crm \
#   APP_NAME=promptzer-crm \
#   DB_NAME=promptzer_crm DB_USER=promptzer \
#   bash setup.sh
# Renaming live deployments to the new defaults is a manual operation
# (rename the directory, pm2 process, and the Postgres DB/role).
#
set -euo pipefail

# ─────────────────────────── Config (override via env) ───────────────────────────
DOMAIN="${DOMAIN:-crm.proptimizr.com}"
APP_PORT="${APP_PORT:-3000}"               # port the CRM listens on (behind nginx)
APP_DIR="${APP_DIR:-/var/www/proptimizr-crm}"
APP_NAME="${APP_NAME:-proptimizr-crm}"     # pm2 process name
REPO_URL="${REPO_URL:-https://github.com/aly-shah/RealEstate.git}"
BRANCH="${BRANCH:-main}"
NODE_MAJOR="${NODE_MAJOR:-22}"

DB_NAME="${DB_NAME:-proptimizr_crm}"
DB_USER="${DB_USER:-proptimizr}"
DB_PASS="${DB_PASS:-$(openssl rand -hex 16)}"

SEED="${SEED:-yes}"                         # seed demo data on first deploy
TLS="${TLS:-yes}"                           # obtain a Let's Encrypt certificate
LE_EMAIL="${LE_EMAIL:-admin@${DOMAIN}}"

# Port-conflict handling:
STOP_PM2_APP="${STOP_PM2_APP:-}"            # name of an existing pm2 app to stop first
FORCE_FREE_PORT="${FORCE_FREE_PORT:-no}"    # 'yes' = kill any non-pm2 process on APP_PORT

log()  { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m! %s\033[0m\n" "$*"; }
die()  { printf "\033[1;31m✗ %s\033[0m\n" "$*"; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run as root (use sudo)."

export DEBIAN_FRONTEND=noninteractive

# ─────────────────────────── 1. Base packages ───────────────────────────
log "Installing base packages"
apt-get update -y
apt-get install -y curl ca-certificates gnupg git openssl ufw lsof iproute2

# ─────────────────────────── 2. Node.js ───────────────────────────
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt "$NODE_MAJOR" ]; then
  log "Installing Node.js $NODE_MAJOR"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
log "Node $(node -v), npm $(npm -v)"

# ─────────────────────────── 3. PostgreSQL ───────────────────────────
log "Installing PostgreSQL"
apt-get install -y postgresql postgresql-contrib
systemctl enable --now postgresql

# ─────────────────────────── 4. nginx + PM2 ───────────────────────────
log "Installing nginx + PM2"
apt-get install -y nginx
command -v pm2 >/dev/null || npm install -g pm2

# ─────────────────────────── 5. Free the target port ───────────────────────────
log "Ensuring port $APP_PORT is free"
if [ -n "$STOP_PM2_APP" ]; then
  warn "Stopping existing PM2 app '$STOP_PM2_APP'"
  pm2 delete "$STOP_PM2_APP" 2>/dev/null || true
fi
PORT_PID="$(ss -lntpH "( sport = :$APP_PORT )" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1 || true)"
if [ -n "$PORT_PID" ]; then
  PNAME="$(ps -p "$PORT_PID" -o comm= 2>/dev/null || echo '?')"
  warn "Port $APP_PORT is held by PID $PORT_PID ($PNAME)"
  # If it's a PM2-managed process (and not us), stop that app cleanly.
  PM_APP="$(pm2 jlist 2>/dev/null | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const a=JSON.parse(d);const m=a.find(p=>String(p.pid)===process.argv[1]);console.log(m?m.name:"")}catch(e){console.log("")}})' "$PORT_PID" || true)"
  if [ -n "$PM_APP" ] && [ "$PM_APP" != "$APP_NAME" ]; then
    warn "Disabling conflicting PM2 app '$PM_APP'"
    pm2 delete "$PM_APP" || true
  elif [ "$PM_APP" != "$APP_NAME" ]; then
    if [ "$FORCE_FREE_PORT" = "yes" ]; then
      warn "Force-killing PID $PORT_PID"
      kill "$PORT_PID" 2>/dev/null || true; sleep 2; kill -9 "$PORT_PID" 2>/dev/null || true
    else
      die "Port $APP_PORT is used by a non-PM2 process ($PNAME). Re-run with FORCE_FREE_PORT=yes to kill it, or set APP_PORT to a free port."
    fi
  fi
fi

# ─────────────────────────── 6. Clone / update repo ───────────────────────────
if [ -d "$APP_DIR/.git" ]; then
  log "Updating existing checkout at $APP_DIR"
  git -C "$APP_DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$APP_DIR" reset --hard "origin/$BRANCH"
else
  log "Cloning $REPO_URL into $APP_DIR"
  mkdir -p "$(dirname "$APP_DIR")"
  git clone --depth 1 -b "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

# ─────────────────────────── 7. Database (first deploy only) ───────────────────────────
FRESH=no
if [ ! -f "$APP_DIR/.env" ]; then
  FRESH=yes
  log "Creating database role + database"
  sudo -u postgres psql <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';
  ELSE
    ALTER ROLE ${DB_USER} PASSWORD '${DB_PASS}';
  END IF;
END \$\$;
SQL
  sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 \
    || sudo -u postgres createdb -O "${DB_USER}" "${DB_NAME}"

  log "Writing .env"
  AUTH_SECRET="$(openssl rand -base64 32)"
  cat > "$APP_DIR/.env" <<ENV
DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}?schema=public"
AUTH_SECRET="${AUTH_SECRET}"
AUTH_URL="https://${DOMAIN}"
AUTH_TRUST_HOST="true"
NODE_ENV="production"
PORT="${APP_PORT}"
ENV
else
  log "Reusing existing .env (DB + secret preserved)"
  # keep public URL + port in sync with current args
  sed -i "s|^AUTH_URL=.*|AUTH_URL=\"https://${DOMAIN}\"|" "$APP_DIR/.env" || true
  grep -q '^PORT=' "$APP_DIR/.env" || echo "PORT=\"${APP_PORT}\"" >> "$APP_DIR/.env"
fi

# ─────────────────────────── 8. Install, migrate, build ───────────────────────────
log "Installing dependencies"
npm ci || npm install

log "Generating Prisma client + syncing schema"
npx prisma generate
npx prisma db push

if [ "$FRESH" = "yes" ] && [ "$SEED" = "yes" ]; then
  log "Seeding demo data"
  npm run db:seed || warn "Seed failed (continuing)"
fi

log "Building Next.js"
npm run build

# ─────────────────────────── 9. PM2 ───────────────────────────
log "Writing PM2 ecosystem config"
cat > "$APP_DIR/ecosystem.config.cjs" <<ECO
module.exports = {
  apps: [{
    name: "${APP_NAME}",
    cwd: "${APP_DIR}",
    script: "node_modules/next/dist/bin/next",
    args: "start -p ${APP_PORT}",
    instances: 1,
    exec_mode: "fork",
    env: { NODE_ENV: "production", PORT: "${APP_PORT}" },
    max_memory_restart: "640M",
  }],
};
ECO

log "Starting under PM2"
pm2 startOrReload "$APP_DIR/ecosystem.config.cjs" --update-env
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

# ─────────────────────────── 10. nginx ───────────────────────────
log "Writing nginx site for $DOMAIN"
cat > "/etc/nginx/sites-available/${DOMAIN}" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    client_max_body_size 12m;        # uploads are capped at 10 MB

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }
}
NGINX
ln -sf "/etc/nginx/sites-available/${DOMAIN}" "/etc/nginx/sites-enabled/${DOMAIN}"
nginx -t
systemctl reload nginx

# ─────────────────────────── 11. Firewall (best-effort) ───────────────────────────
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 'Nginx Full' >/dev/null 2>&1 || true
fi

# ─────────────────────────── 12. TLS ───────────────────────────
if [ "$TLS" = "yes" ]; then
  log "Obtaining Let's Encrypt certificate"
  apt-get install -y certbot python3-certbot-nginx
  if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$LE_EMAIL" --redirect; then
    echo "TLS configured."
  else
    warn "certbot failed — make sure $DOMAIN points to this server's IP, then run: certbot --nginx -d $DOMAIN"
  fi
fi

# ─────────────────────────── Done ───────────────────────────
log "Deploy complete"
cat <<DONE

  App:        https://${DOMAIN}   (http://127.0.0.1:${APP_PORT} behind nginx)
  Directory:  ${APP_DIR}
  PM2:        pm2 status ${APP_NAME}   ·   pm2 logs ${APP_NAME}
  Database:   ${DB_NAME} (user ${DB_USER})

  Demo logins (password: 'password'):
    owner@proptimizr.test · admin@proptimizr.test · agent@proptimizr.test
    dealer@proptimizr.test · support@proptimizr.com

  Redeploy after a push:  cd ${APP_DIR} && git pull && npm ci && npm run build && pm2 reload ${APP_NAME}
DONE
