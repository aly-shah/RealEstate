# Production Compromise — Clean-Rebuild Runbook

**Date:** 2026-06-08 · **Trigger:** cryptominer running as **root** on the prod VPS
(`38.247.145.231`), masquerading as `syslog-ng-5366e949` (deleted binary, hidden dir
`/usr/share/man/man3/.syslog-dbc8a4c0`, ~295% CPU). The app was also down (PM2 daemon
had died → nginx 502); it has been restarted, but the host is untrusted.

## Scope — read first
- The miner ran as **root** → treat the **entire host as compromised**. You cannot
  reliably clean a root compromise in place; rebuild on a fresh host.
- This box hosts **multiple projects** (nginx sites: `crm.proptimizr.com`, `dentacore`,
  `drsaab`, `scalamatic`, `scalamedic`; plus `mongod` and python services). **All are
  compromised.** This runbook covers Proptimizr; the others need the same treatment or
  decommissioning.
- The VPS git checkout has **push** access to `github.com/aly-shah/RealEstate`. Assume
  that credential is leaked and the repo *could* have been tampered → **verify repo
  integrity and rotate that credential before trusting "rebuild from GitHub."**
- Secrets on the box: `AUTH_SECRET`, `DATABASE_URL` (DB password). No Anthropic /
  WhatsApp / jobs-token configured. Assume both leaked.

## Keep vs rebuild
- **Keep (data only):** Postgres DB (~11 MB) + `uploads/` (~452 KB).
- **Rebuild from scratch:** OS, packages, app code (from *verified* GitHub),
  nginx/PM2/certbot config, `.env` (new secrets).
- **Never copy from the old box:** any binary, the app directory, cron, systemd units,
  SSH keys, or configs. Only data leaves the old box.

**Target stack (match current):** Ubuntu 24.04 LTS · Node **22 LTS** (was v22.22.2) ·
PostgreSQL **16** · nginx 1.24 · PM2 (fork mode) · certbot.

---

## Phase 0 — Now (preserve data, verify source, stop the bleed)
1. **Verify the GitHub repo from your trusted local machine** (not the box):
   ```
   git fetch origin && git log --oneline -30 origin/main
   ```
   Confirm every commit is one you recognize (authors + messages). Check GitHub →
   Settings → Security log for unexpected pushes. If clean, `origin/main` is your
   trusted rebuild source.
2. **Rotate the GitHub credential the VPS holds** (it has push): revoke the PAT/deploy
   key the old box used; you'll mint a least-privilege one for the new box later.
3. **Pull the data off the box** (run from your local machine):
   ```
   ssh root@38.247.145.231 'pg_dump "$(grep ^DATABASE_URL /var/www/RealEstate/.env | cut -d= -f2- | tr -d "\"" | sed "s/?.*//")" -Fc' > proptimizr-$(date +%F).dump
   scp -r root@38.247.145.231:/var/www/RealEstate/uploads ./uploads-backup
   ```
   Then **scan `uploads-backup` with ClamAV** before reusing (the app's upload virus
   scan is a stub, so anything could be in there).
4. **(Optional) kill the miner** to keep prod responsive during migration — it may
   respawn from hidden persistence; don't chase it, you're rebuilding:
   ```
   ssh root@38.247.145.231 'ps -eo pid,pcpu,comm --sort=-pcpu | head; kill -9 <miner_pid>'
   ```
5. **Lower the DNS TTL** for `crm.proptimizr.com` to 60s now (it's already ~94s) so the
   cutover is fast.

## Phase 1 — Provision a fresh host
- New VPS instance — **ideally a different provider/account**, since the entry vector
  is unknown. Ubuntu 24.04 LTS, then `apt update && apt full-upgrade`.
- **Harden before deploying anything:**
  - SSH key-only (new keypair), `PermitRootLogin no`, a sudo user, password auth off.
  - `ufw default deny incoming; ufw allow 22,80,443/tcp; ufw enable` · install `fail2ban`.
  - Enable unattended security upgrades.
- Install: Node 22 LTS, PostgreSQL 16, nginx, certbot + python3-certbot-nginx, git,
  build-essential; `npm i -g pm2`.
- **Do not co-host the other projects here** unless each is independently rebuilt — one
  shared box is exactly how a single breach took everything down.

## Phase 2 — Restore data
1. New DB role (new strong password) + database:
   ```
   sudo -u postgres createuser --pwprompt re_prod
   sudo -u postgres createdb -O re_prod promptzer_crm
   ```
2. Restore:
   ```
   pg_restore -d "postgresql://re_prod:NEWPASS@localhost/promptzer_crm" --no-owner proptimizr-DATE.dump
   ```
3. **Inspect for tampering** (the attacker had DB access):
   ```sql
   SELECT email, role, "createdAt" FROM "User"
   WHERE role IN ('SUPER_ADMIN','OWNER','ADMIN') ORDER BY "createdAt";
   -- confirm every privileged account is legitimate; look for unexpected rows
   SELECT id, "whatsappAccessToken" IS NOT NULL AS has_wa FROM "Company";
   -- note any non-null WhatsApp tokens (see Phase 5 re: AUTH_SECRET)
   ```
4. Copy the **scanned** uploads to `/var/www/RealEstate/uploads`.

## Phase 3 — Deploy the app (clean, from GitHub)
1. `git clone https://github.com/aly-shah/RealEstate.git /var/www/RealEstate`
2. Create `/var/www/RealEstate/.env` with **rotated** secrets:
   ```
   DATABASE_URL="postgresql://re_prod:NEWPASS@localhost:5432/promptzer_crm?schema=public"
   AUTH_SECRET="$(openssl rand -base64 48)"        # fresh value
   AUTH_URL="https://crm.proptimizr.com"
   AUTH_TRUST_HOST="true"
   NODE_ENV="production"
   PORT="3000"
   ```
3. `npm ci && npx prisma generate && npx prisma db push --skip-generate`
   (schema already matches the restored dump → no-op).
4. **Re-apply the DB-level statement timeout** — a plain DB dump does *not* carry
   `ALTER DATABASE` settings (the trigram extension/indexes + CHECK constraints *are*
   in the dump, so those carry over):
   ```sql
   ALTER DATABASE promptzer_crm SET statement_timeout = '8s';
   ```
5. `npm run build`
6. Recreate `ecosystem.config.cjs` (it lived on the old box, not in the repo):
   ```js
   module.exports = { apps: [{
     name: "promptzer-crm", cwd: "/var/www/RealEstate",
     script: "node_modules/next/dist/bin/next", args: "start -p 3000",
     instances: 1, exec_mode: "fork",
     env: { NODE_ENV: "production", PORT: "3000" }, max_memory_restart: "640M",
   }]};
   ```
   ```
   pm2 start ecosystem.config.cjs && pm2 save
   pm2 startup systemd      # run the command it prints — so a daemon death/reboot self-heals
   ```
   > The original outage happened because the PM2 daemon died and nothing resurrected it.
   > `pm2 startup` + `pm2 save` is what prevents a repeat.

## Phase 4 — nginx + TLS + DNS cutover
1. Fresh nginx server block for `crm.proptimizr.com` → `proxy_pass http://127.0.0.1:3000;`
   (recreate from scratch; standard proxy headers). **Do not copy the old config.**
2. Repoint DNS `A crm.proptimizr.com` → **new IP** (TTL already low).
3. After it propagates: `certbot --nginx -d crm.proptimizr.com`.
4. Jobs cron: none was active on the old box, so the queue/sweeps were idle. If you want
   them, add `JOBS_TICK_TOKEN` to `.env` and the `* * * * *` curl from
   `src/app/api/jobs/tick/route.ts`'s header. Otherwise leave it off.

## Phase 5 — Rotate every secret
- **AUTH_SECRET** — new (Phase 3). Side effects: invalidates all existing user sessions
  (everyone re-logs-in — desirable post-breach). ⚠️ If any `Company.whatsappAccessToken`
  was non-null (Phase 2 check), it was AES-GCM-encrypted with the *old* secret and won't
  decrypt under the new one → re-enter those tokens via Settings (or migrate them:
  decrypt with old key, re-encrypt with new, *before* cutover). Likely nothing, since no
  WhatsApp is configured.
- **DB password** — new (Phase 2).
- **GitHub Actions deploy key** (`.github/workflows/deploy.yml` → appleboy/ssh-action):
  new SSH keypair → public key in the new box's `authorized_keys`, private key into the
  GH Actions secret; update the workflow's target host/IP; revoke the old key.
- **VPS → GitHub push credential:** the new box should use a **read-only** deploy key or
  least-privilege PAT (the deploy only fetches). Revoke whatever the old box used.
- **App user passwords:** the DB (bcrypt hashes) was exposed. bcrypt is slow to crack,
  but force a reset for privileged accounts (SUPER_ADMIN / OWNER / ADMIN) at minimum.

## Phase 6 — Verify & decommission
- `curl https://crm.proptimizr.com/login` → 200; log in; click through; watch
  `pm2 logs promptzer-crm`.
- **Destroy the old VPS** (don't reuse the image). Report the abuse to the hosting
  provider — the miner likely used your IP/bandwidth for outbound activity.
- Rebuild or decommission the **other apps** on the old box (dentacore, drsaab,
  scalamatic, scalamedic, mongod) the same way.

## Entry vector — investigated 2026-06-08 (findings)
MongoDB is **ruled out** — not externally exposed, no `mongod.conf`. The actual exposure:

- **SSH password auth was ON** (`PasswordAuthentication yes`) with **2,738 failed-password
  attempts** logged — the box was under active brute-force and password login was reachable.
- **Every web app runs as `root`** via PM2 (`promptzer-crm`, `scalamatic`, `scalamedic`, …).
  Any RCE in any one Node app or its dependencies = instant root. This is the single biggest
  misconfiguration.
- **Extra services exposed to the internet:** `:9090` = `pm2 serve` (Scalamatic), `:4001` =
  another Next app, and the Next apps bind `0.0.0.0` (reachable directly, not just via nginx).
- No injected SSH keys found (all `authorized_keys` map to you / github-actions), and no
  cron/systemd/ld.so.preload persistence — the miner persists via a **bash watchdog**
  (holds `.daemon.lock`) that respawns it, so killing it in place is futile.
- `154.57.213.16` (280 logins) is **confirmed as the operator's own IP** (this machine /
  Claude Code sessions), NOT an attacker. No stolen-key / active-intruder evidence — the
  compromise is the dropped cryptominer, not a hands-on-keyboard adversary.
- For review: `/tmp/deploy2.sh` present (confirm it's yours).

**Most likely:** a cracked SSH password or an RCE in one of the root-run apps. Either way,
the rebuild MUST fix both root causes (below) — don't just patch one.

### Mandatory hardening on the new host (beyond Phase 1)
- **`PasswordAuthentication no`** — key-only SSH, `PermitRootLogin no`.
- **Run the app as a dedicated non-root user** (e.g. `appuser`); PM2 under that user, not root.
  `chown -R appuser /var/www/RealEstate`. A future app RCE then can't reach root.
- **Bind app ports to `127.0.0.1`** (nginx is the only public entry). For Next: put it behind
  nginx and firewall 3000/4001/9090; never run `pm2 serve` on a public port.
- **One project per box**, or at least isolate them (separate users / containers). One shared
  root box meant a single breach took everything down.
