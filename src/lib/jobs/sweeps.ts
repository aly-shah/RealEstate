import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { decryptSecret } from "@/lib/crypto";
import { pingWhatsAppToken, fetchTemplateCatalog } from "@/lib/wa-business";
import { persistTemplateCatalog } from "@/lib/wa-templates";

/**
 * "Sweep" jobs are always-run checks called directly from the tick endpoint
 * rather than queued. Reason: they're idempotent + cheap + we want them to
 * fire on every tick regardless of queue depth. If you ever need throttling,
 * move the sweep into a queued job with a recurring re-enqueue at the end.
 */

export interface SweepResult {
  trialsExpired: number;
}

export interface ReaperResult {
  /** Number of stuck RUNNING rows that were reset back to QUEUED. */
  resetToQueued: number;
  /** Number that exhausted their retry budget and were marked FAILED. */
  finallyFailed: number;
}

/**
 * Stuck-job reaper. When the runner crashes mid-job (PM2 reload, OOM, etc.)
 * a row can sit in RUNNING forever. This sweep finds any RUNNING row whose
 * `claimedAt` is older than `staleMs` ago and decides what to do:
 *   - Within retry budget → reset to QUEUED for the next tick to pick up.
 *   - Out of budget → mark FAILED so /admin/jobs surfaces it for ops.
 *
 * The retry-budget check is important — otherwise a poison message (handler
 * that always hangs) would resurrect forever.
 *
 * Default staleness is 5 minutes — long enough that a legitimately-slow
 * handler isn't reaped mid-run, short enough that a real crash gets
 * surfaced within a couple ticks.
 */
export async function sweepStuckJobs(staleMs = 5 * 60 * 1000): Promise<ReaperResult> {
  const cutoff = new Date(Date.now() - staleMs);
  const stuck = await prisma.job.findMany({
    where: { status: "RUNNING", claimedAt: { lt: cutoff } },
    select: { id: true, attempts: true, maxAttempts: true },
  });
  if (stuck.length === 0) return { resetToQueued: 0, finallyFailed: 0 };

  let resetToQueued = 0;
  let finallyFailed = 0;
  for (const j of stuck) {
    // attempts was already incremented when the row was claimed, so the
    // current value reflects the failed attempt we're recovering from.
    const exhausted = j.attempts >= j.maxAttempts;
    await prisma.job.update({
      where: { id: j.id },
      data: exhausted
        ? {
            status: "FAILED",
            error: "Stuck in RUNNING (server crashed?) and retry budget exhausted",
            finishedAt: new Date(),
            claimedAt: null,
          }
        : {
            status: "QUEUED",
            // Brief delay so a chronically-failing handler doesn't hot-loop.
            runAt: new Date(Date.now() + 30_000),
            error: "Reaped from stuck RUNNING",
            claimedAt: null,
            startedAt: null,
          },
    });
    if (exhausted) finallyFailed += 1;
    else resetToQueued += 1;
  }
  return { resetToQueued, finallyFailed };
}

export interface PurgeResult {
  jobsDeleted: number;
  notificationsDeleted: number;
  aiSuggestionsDeleted: number;
}

/**
 * Retention sweep — deletes long-completed work so the tables don't grow
 * forever. Caller throttles cadence (the tick endpoint runs this at most
 * once per day). Safe to call any time; nothing references DONE jobs,
 * read notifications, or stale AI suggestions past their TTL.
 *
 *   - Job DONE rows older than 30 days → deleted.
 *   - Notification rows where read=true AND createdAt < 90 days → deleted.
 *   - AiSuggestion rows older than 30 days → deleted (see note below).
 *   - FAILED jobs are kept regardless (need ops visibility).
 *   - ActivityLog rows are NEVER auto-deleted — they're the audit trail.
 *
 * AiSuggestion retention note: the longest in-app cache freshness window
 * is 6h (owner weekly insight). After ~a day every row is dead weight
 * for caching purposes, but the budget counter (checkAiBudget) only
 * looks at `createdAt >= monthStart` so 30 days keeps the in-month
 * window intact for any tenant + provides ~1 month of historical
 * audit before the row gets reclaimed. Per-tenant usage rollups
 * should be aggregated externally if longer history is needed.
 */
export async function purgeOldRows(opts: {
  jobsTtlDays?: number;
  notificationsTtlDays?: number;
  aiSuggestionsTtlDays?: number;
} = {}): Promise<PurgeResult> {
  const {
    jobsTtlDays = 30,
    notificationsTtlDays = 90,
    aiSuggestionsTtlDays = 30,
  } = opts;
  const now = Date.now();

  const [jobs, notifs, aiSugs] = await Promise.all([
    prisma.job.deleteMany({
      where: {
        status: "DONE",
        finishedAt: { lt: new Date(now - jobsTtlDays * 86_400_000) },
      },
    }),
    prisma.notification.deleteMany({
      where: {
        read: true,
        createdAt: { lt: new Date(now - notificationsTtlDays * 86_400_000) },
      },
    }),
    prisma.aiSuggestion.deleteMany({
      where: {
        createdAt: { lt: new Date(now - aiSuggestionsTtlDays * 86_400_000) },
      },
    }),
  ]);
  return {
    jobsDeleted: jobs.count,
    notificationsDeleted: notifs.count,
    aiSuggestionsDeleted: aiSugs.count,
  };
}

/**
 * Flips Company.billingStatus from TRIAL → PAST_DUE for any tenant whose
 * trialEndsAt is in the past. Writes an ActivityLog entry per affected
 * company so the activity feed shows the auto-transition.
 *
 * Idempotent: a company already at PAST_DUE is excluded by the where-clause.
 * Safe to call every minute.
 */
export async function sweepExpiredTrials(): Promise<SweepResult> {
  const now = new Date();
  const expired = await prisma.company.findMany({
    where: {
      billingStatus: "TRIAL",
      trialEndsAt: { lt: now },
    },
    select: { id: true, name: true, trialEndsAt: true },
  });
  if (expired.length === 0) return { trialsExpired: 0 };

  await prisma.company.updateMany({
    where: { id: { in: expired.map((c) => c.id) } },
    data: { billingStatus: "PAST_DUE" },
  });

  // Per-tenant activity log entries so the office sees the transition in
  // their /activity feed without needing to know the sweep ran.
  await Promise.all(
    expired.map((c) =>
      logActivity({
        companyId: c.id,
        action: "company.trial_expired",
        entityType: "COMPANY",
        entityId: c.id,
        summary: `Trial expired — billing status auto-set to PAST_DUE`,
        meta: { trialEndsAt: c.trialEndsAt?.toISOString() ?? null, newStatus: "PAST_DUE" },
      }),
    ),
  );

  return { trialsExpired: expired.length };
}

export interface TokenProbeResult {
  checked: number;
  /** Tenants whose token failed the validity ping this run. */
  failed: number;
  /** Tenants where the stored ciphertext couldn't be decrypted (key rotated?). */
  undecryptable: number;
}

/**
 * Phase-9.5 risk-fix B — daily token validity probe.
 *
 * For every tenant that has BOTH `whatsappPhoneId` AND `whatsappAccessToken`
 * configured, GET /<phone_number_id> on the Meta graph API with the stored
 * token (decrypted via lib/crypto.ts). Meta returns 200 for valid tokens,
 * 401 for expired/revoked, 403 for permission-stripped. Failures are
 * logged to ActivityLog as `whatsapp.token_invalid` so the owner sees
 * "your token expired" in their feed BEFORE the next outbound send
 * blows up — Meta tokens typically live ~60 days unless backed by a
 * system user.
 *
 * Caller (jobs tick endpoint) throttles to once per 24h to stay well
 * under Meta's per-token API rate limits. Within a run the probes run
 * in parallel chunks (default 10) so a 500-tenant deployment finishes
 * in ~10× the per-probe latency (~500ms) instead of ~250s sequential.
 * The chunk size is bounded to keep the connection pool happy and to
 * avoid Meta returning 429 if a single token is shared across many
 * tenants (unusual but possible during partner onboarding).
 */
const PROBE_CHUNK_SIZE = 10;

export async function sweepWhatsAppTokens(): Promise<TokenProbeResult> {
  const candidates = await prisma.company.findMany({
    where: {
      whatsappPhoneId: { not: null },
      whatsappAccessToken: { not: null },
    },
    select: { id: true, name: true, whatsappPhoneId: true, whatsappAccessToken: true },
  });
  if (candidates.length === 0) return { checked: 0, failed: 0, undecryptable: 0 };

  // Per-tenant probe — returns "ok" / "decryption_failed" / "ping_failed"
  // + the activity log to write. Pure function so chunked Promise.all
  // composes cleanly without shared mutable state.
  type Outcome =
    | { kind: "ok" }
    | { kind: "decryption_failed"; companyId: string }
    | { kind: "ping_failed"; companyId: string; status: number; error: string };

  const probeOne = async (c: (typeof candidates)[number]): Promise<Outcome> => {
    const token = decryptSecret(c.whatsappAccessToken);
    if (!token) return { kind: "decryption_failed", companyId: c.id };
    const result = await pingWhatsAppToken({
      phoneNumberId: c.whatsappPhoneId!,
      accessToken: token,
    });
    if (result.ok) return { kind: "ok" };
    return { kind: "ping_failed", companyId: c.id, status: result.status, error: result.error };
  };

  const outcomes: Outcome[] = [];
  for (let i = 0; i < candidates.length; i += PROBE_CHUNK_SIZE) {
    const chunk = candidates.slice(i, i + PROBE_CHUNK_SIZE);
    const results = await Promise.all(chunk.map(probeOne));
    outcomes.push(...results);
  }

  // Write activity logs after the probes complete — keeps the network
  // calls and DB writes phased so a slow log insert doesn't extend the
  // probe budget for the next chunk.
  let failed = 0;
  let undecryptable = 0;
  for (const o of outcomes) {
    if (o.kind === "ok") continue;
    if (o.kind === "decryption_failed") {
      undecryptable += 1;
      await logActivity({
        companyId: o.companyId,
        action: "whatsapp.token_invalid",
        entityType: "COMPANY",
        entityId: o.companyId,
        summary: "WhatsApp access token failed to decrypt — re-save it in Settings → Integrations.",
        meta: { reason: "decryption_failed" },
      });
    } else {
      failed += 1;
      await logActivity({
        companyId: o.companyId,
        action: "whatsapp.token_invalid",
        entityType: "COMPANY",
        entityId: o.companyId,
        summary: `WhatsApp token probe failed (${o.status}): ${o.error.slice(0, 120)}`,
        meta: { reason: "ping_failed", status: o.status, error: o.error },
      });
    }
  }

  return { checked: candidates.length, failed, undecryptable };
}

export interface TemplateCatalogSweepResult {
  /** Tenants that had both WABA id + decryptable token at sweep time. */
  candidates: number;
  /** Tenants whose catalog refreshed successfully (any non-zero size). */
  refreshed: number;
  /** Total templates upserted across all tenants. */
  upserted: number;
  /** Total templates pruned across all tenants. */
  pruned: number;
  /** Tenants whose Meta call failed (auth, network, rate limit). */
  failed: number;
}

/**
 * Phase-9.5 risk-fix #3 — daily template catalog refresh.
 *
 * For every tenant with both `whatsappBusinessAccountId` AND a decryptable
 * `whatsappAccessToken`, fetch the latest catalog from Meta and re-persist
 * via the shared `persistTemplateCatalog` helper. Cron tick endpoint
 * throttles to once per 24h.
 *
 * Catalogs change rarely (owners curate templates infrequently), but the
 * "owner approved a new template but forgot to click Sync in Settings"
 * gap was a real risk before this. Now the worst case is a 24h lag.
 *
 * Runs sequentially per tenant — most deployments have <10 tenants with
 * WhatsApp configured and Meta's per-token rate limit makes per-tenant
 * parallelism brittle. The PER-TENANT upserts (inside
 * `persistTemplateCatalog`) are already chunked + parallel.
 *
 * On per-tenant failure we log + continue rather than aborting the whole
 * sweep so one tenant with a revoked token can't starve the rest.
 */
export async function sweepWhatsAppTemplateCatalog(): Promise<TemplateCatalogSweepResult> {
  const candidates = await prisma.company.findMany({
    where: {
      whatsappBusinessAccountId: { not: null },
      whatsappAccessToken: { not: null },
    },
    select: {
      id: true,
      name: true,
      whatsappBusinessAccountId: true,
      whatsappAccessToken: true,
    },
  });
  if (candidates.length === 0) {
    return { candidates: 0, refreshed: 0, upserted: 0, pruned: 0, failed: 0 };
  }

  let refreshed = 0;
  let upserted = 0;
  let pruned = 0;
  let failed = 0;

  for (const c of candidates) {
    const token = decryptSecret(c.whatsappAccessToken);
    if (!token) {
      // Don't double-log — the token-probe sweep already surfaces
      // decryption failures with the actionable message. Just count + skip.
      failed += 1;
      continue;
    }
    const result = await fetchTemplateCatalog({
      wabaId: c.whatsappBusinessAccountId!,
      accessToken: token,
    });
    if (!result.ok) {
      failed += 1;
      await logActivity({
        companyId: c.id,
        action: "whatsapp.templates_sync_failed",
        entityType: "COMPANY",
        entityId: c.id,
        summary: `Auto template sync failed (${result.status}): ${result.error.slice(0, 120)}`,
        meta: { status: result.status, error: result.error },
      });
      continue;
    }
    const persistResult = await persistTemplateCatalog(c.id, result.templates);
    refreshed += 1;
    upserted += result.templates.length;
    pruned += persistResult.pruned;
  }

  return { candidates: candidates.length, refreshed, upserted, pruned, failed };
}
