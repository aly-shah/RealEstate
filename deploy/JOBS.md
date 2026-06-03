# Proptimizr CRM — Background jobs + webhooks

Phase 8.5 introduces a minimal Postgres-backed job queue and a WhatsApp webhook receiver. Both are designed to run on the existing single-VPS deploy — no Redis, no separate worker process. A cron entry pings an internal endpoint once a minute; that endpoint drains the queue + runs always-on sweeps.

## What's in the queue

| Job type | Producer | Purpose |
|----------|----------|---------|
| `trial.expire` | (sweep, not queued) | Flips `Company.billingStatus` from TRIAL → PAST_DUE when `trialEndsAt` passes. Idempotent. |
| `whatsapp.inbound` | `POST /api/webhooks/whatsapp` | One job per inbound WhatsApp message. Phase-8.5 handler just logs; Phase 9 will create leads + run AI classification. |
| `test.echo` | `/admin/jobs` "+ Test job" | Smoke-test the queue end-to-end. Returns the payload as the result. |

Add a new type by:
1. Adding a constant in `src/lib/jobs/types.ts:JOB_TYPES`.
2. Writing a handler under `src/lib/jobs/handlers/`.
3. Registering it in `src/lib/jobs/runner.ts:REGISTRY`.

The runner enforces per-job retry (default 3 attempts, exponential backoff: 1m → 2m → 4m). Beyond `maxAttempts` the job lands in FAILED and shows up in `/admin/jobs` for manual re-queue.

## Required environment variables

| Var | What | Where used |
|-----|------|-----------|
| `JOBS_TICK_TOKEN` | Shared secret for the cron-driven `/api/jobs/tick` endpoint. Generate with `openssl rand -hex 32`. | `app/api/jobs/tick/route.ts` |
| `WHATSAPP_VERIFY_TOKEN` | Token Meta calls with during webhook verification. You choose it; configure the same string in the Meta dashboard. | `app/api/webhooks/whatsapp/route.ts` |
| `WHATSAPP_APP_SECRET` | App Secret from the Meta app console. Used to HMAC-validate every inbound payload. | `app/api/webhooks/whatsapp/route.ts` |

Append to the existing `.env` on the VPS:

```bash
echo 'JOBS_TICK_TOKEN="'$(openssl rand -hex 32)'"' >> /var/www/proptimizr-crm/.env
echo 'WHATSAPP_VERIFY_TOKEN=""'                    >> /var/www/proptimizr-crm/.env
echo 'WHATSAPP_APP_SECRET=""'                      >> /var/www/proptimizr-crm/.env
pm2 reload proptimizr-crm
```

If `JOBS_TICK_TOKEN` is unset, the tick endpoint fail-closes with `HTTP 503 "JOBS_TICK_TOKEN not configured"` — by design, so an unconfigured endpoint can't be misused.

## Install the cron

```bash
TOKEN="$(grep -E '^JOBS_TICK_TOKEN=' /var/www/proptimizr-crm/.env | head -1 | cut -d= -f2- | tr -d '"')"
URL="https://crm.proptimizr.com/api/jobs/tick"

# Every minute, no overlap. Output appended to a rotating log file.
(crontab -l 2>/dev/null; cat <<CRON) | crontab -
* * * * * curl -fsS -X POST -H "Authorization: Bearer $TOKEN" "$URL" >> /var/log/proptimizr-jobs.log 2>&1
CRON

# Logrotate so the file doesn't grow forever.
cat <<'LOGROT' > /etc/logrotate.d/proptimizr-jobs
/var/log/proptimizr-jobs.log {
  weekly
  rotate 8
  compress
  missingok
  notifempty
  copytruncate
}
LOGROT
```

Verify:

```bash
# Should print a JSON body with sweep + queue totals.
curl -fsS -X POST -H "Authorization: Bearer $TOKEN" "$URL" | jq
```

## /admin/jobs — what to watch

Super Admin → **Jobs** page:

- **Queued count climbing** → cron isn't firing. Check `/var/log/proptimizr-jobs.log` for `401 Unauthorized` (token mismatch) or `503 not configured` (env var missing).
- **Many FAILED rows of the same type** → bug in that handler. Click into the row to see the error message; fix; click **Re-queue** to retry with a fresh budget.
- **Running rows that never finish** → process crashed mid-job. Click ✕ to delete; the underlying work is idempotent for current handlers, so re-trigger from the producer.

## Trial-expiry sweep

Runs on every tick (not queued). Flips any `Company` with `billingStatus = TRIAL` AND `trialEndsAt < now()` to `billingStatus = PAST_DUE`. Writes a `company.trial_expired` activity-log entry per affected tenant so the tenant's `/activity` page records the transition.

No code change needed when adding a new tenant — give them `plan = TRIAL` + `trialEndsAt = <date>` via the Super Admin onboarding form; the sweep handles the rest.

## WhatsApp webhook setup

Meta Business → your WhatsApp app → **Webhooks**:

| Field | Value |
|-------|-------|
| Callback URL | `https://crm.proptimizr.com/api/webhooks/whatsapp` |
| Verify token | The same string you set in `WHATSAPP_VERIFY_TOKEN` |
| Subscription fields | `messages` (at minimum) |

When Meta clicks **Verify**, the GET handler echoes `hub.challenge` back. After that, every inbound message hits the POST handler:

1. HMAC-SHA256 signature validated against `WHATSAPP_APP_SECRET` (fail-closed on any mismatch — log shows 401).
2. Payload parsed for messages.
3. One `whatsapp.inbound` job enqueued per message.
4. Response sent back to Meta immediately (long-running work is deferred to the queue — Meta retries on timeouts).

Today the handler just logs to `ActivityLog`. Phase 9 will:
- Route the message to the right tenant via the destination phone-number-id.
- Dedup against existing clients.
- Create a Lead with `source = PORTAL`, `importSource = "WHATSAPP"`.
- Optionally fire an AI classifier to set `prefType` / `prefArea`.

## Local testing

The queue works without the cron — call `/api/jobs/tick` manually:

```bash
# From your laptop, pointing at a local dev server.
curl -X POST -H "Authorization: Bearer $JOBS_TICK_TOKEN" http://localhost:3000/api/jobs/tick
```

Or click **+ Test job** in `/admin/jobs` to enqueue a `test.echo`, then trigger one tick to confirm it goes QUEUED → DONE with the payload mirrored in `result`.

## What's NOT in this phase

- Outbound message delivery (still wa.me deep links from the lead/property/deal pages).
- Per-tenant routing of inbound WhatsApp messages — the queue gets them, the handler logs them, the lead-creation hookup is Phase 9.
- A persistent worker process. The current cron-driven model is fine for the expected scale; if you outgrow it, the cleanest upgrade is to switch the runner to a long-lived Node process (e.g. `npx tsx scripts/worker.ts`) with the same handler registry.
- Job priorities / queue lanes. One FIFO queue handles everything; if specific handlers ever need to bypass long-tail batches, add a `priority` column + ORDER BY.
- Retries with exponential backoff beyond 4 minutes. After `maxAttempts`, jobs go FAILED and need manual intervention — that's the right behavior for "the AI API is genuinely down for hours".
