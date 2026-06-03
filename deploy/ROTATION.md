# Secret rotation runbook

The system has two long-lived secrets that periodically need rotation:

| Secret | What breaks if it leaks | Rotate via |
|--------|-------------------------|------------|
| `AUTH_SECRET` | NextAuth session forgery + WhatsApp token decryption | This runbook |
| `JOBS_TICK_TOKEN` | Anyone can trigger the cron tick endpoint | Trivial — see end |
| Per-tenant `whatsappAccessToken` | Outbound WhatsApp sends from the tenant's line | Owner: Settings → Integrations → Replace |

## Why AUTH_SECRET is special

`Company.whatsappAccessToken` is stored AES-256-GCM-encrypted under a
key derived from `AUTH_SECRET` (SHA-256). **If you rotate AUTH_SECRET
without first re-encrypting**, every stored token becomes
undecryptable: outbound WhatsApp stops working for every tenant, and
the daily token-validity sweep (`sweepWhatsAppTokens`) starts logging
`whatsapp.token_invalid` activity entries with `reason: decryption_failed`.

Session cookies signed with the old `AUTH_SECRET` also become invalid,
forcing a re-login — that's normal NextAuth behavior, not a defect.

## The procedure

### 1. Pre-flight

```bash
# On the VPS, snapshot the current secret.
cd /var/www/proptimizr-crm
grep '^AUTH_SECRET=' .env
# Copy the value into your password manager as `OLD_AUTH_SECRET`.
```

If you don't have the old value, you can't re-encrypt — every owner will
need to re-paste their token after the rotation. (This is also the
expected recovery path if AUTH_SECRET was lost.)

### 2. Take a backup

```bash
sudo /usr/local/bin/proptimizr-backup.sh  # or whatever your scheduled cmd is
```

Verify the dump landed under `/var/backups/proptimizr/` per `BACKUP.md`.

### 3. Pick the new secret

```bash
NEW_AUTH_SECRET="$(openssl rand -base64 32)"
echo "$NEW_AUTH_SECRET"   # store in password manager as the new value
```

### 4. Dry-run the re-encrypt

```bash
cd /var/www/proptimizr-crm
OLD_AUTH_SECRET="<old value from step 1>" \
AUTH_SECRET="$NEW_AUTH_SECRET" \
DATABASE_URL="$(grep ^DATABASE_URL .env | cut -d= -f2- | tr -d '"')" \
  npx tsx scripts/reencrypt-tokens.ts --dry-run
```

Expected output:

```
Found N tenant(s) with a stored access token.
  [dry] Tenant A (cuid_…)
  [dry] Tenant B (cuid_…)
  …
Rotated:           N (dry-run, no writes)
Already new key:   0
Legacy → encrypted: 0
Unreadable (skip): 0
```

Any **Unreadable** rows mean the old key already can't decrypt them —
those owners will need to re-paste manually after the rotation. Note
the count.

### 5. Execute

```bash
# Same env, no --dry-run.
OLD_AUTH_SECRET="<old value>" \
AUTH_SECRET="$NEW_AUTH_SECRET" \
DATABASE_URL="$(grep ^DATABASE_URL .env | cut -d= -f2- | tr -d '"')" \
  npx tsx scripts/reencrypt-tokens.ts
```

This runs one Prisma `update` per row inside the script's loop — no
single transaction, so a mid-run interruption leaves the DB partially
rotated. **Re-running is safe**: the script detects rows already under
the new key and skips them.

### 6. Swap the env var + reload

```bash
sudo sed -i "s|^AUTH_SECRET=.*|AUTH_SECRET=\"$NEW_AUTH_SECRET\"|" /var/www/proptimizr-crm/.env
pm2 reload proptimizr-crm
```

### 7. Verify

```bash
# Trigger the daily WhatsApp token probe immediately by clearing its throttle.
# Easiest way is just to restart PM2 (already done above) and call the tick
# with the right bearer.
curl -fsS -X POST \
  -H "Authorization: Bearer $(grep ^JOBS_TICK_TOKEN /var/www/proptimizr-crm/.env | cut -d= -f2- | tr -d '\"')" \
  https://crm.proptimizr.com/api/jobs/tick | jq .waProbe
```

Expect `checked: N`, `failed: 0`, `undecryptable: 0`. Any non-zero
`undecryptable` means the rotation script missed a row — re-run step 5.

### 8. Re-paste unreadable tokens (if any)

For each tenant flagged Unreadable in step 4: ask the OWNER to log in
and re-paste their token via Settings → Integrations → Replace.

## Rolling back

If something goes wrong:

1. Restore `AUTH_SECRET` to the OLD value in `.env`.
2. `pm2 reload proptimizr-crm`.
3. Tokens encrypted under the OLD key decrypt again immediately.
4. Tokens that got re-encrypted to the NEW key in step 5 are now
   undecryptable under the OLD secret — affected owners need to re-paste.

Roll back early. The longer you wait, the more cross-rotation writes
land in mixed state.

---

## JOBS_TICK_TOKEN rotation

Trivial — this secret only authenticates the cron endpoint, nothing
encrypts under it:

```bash
NEW_TOKEN="$(openssl rand -base64 32)"
sudo sed -i "s|^JOBS_TICK_TOKEN=.*|JOBS_TICK_TOKEN=\"$NEW_TOKEN\"|" /var/www/proptimizr-crm/.env
pm2 reload proptimizr-crm
# Update the crontab line to use the new value.
sudo crontab -e
```

Briefly the old cron line will 401 — at most one missed tick. The
reaper sweep on the next tick picks up anything that was due.
