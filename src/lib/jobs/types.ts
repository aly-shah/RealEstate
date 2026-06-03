/**
 * Job handler contract. Each registered handler receives the parsed payload
 * and returns an arbitrary JSON-serialisable result (stored on Job.result)
 * — or throws, which the runner catches + retries up to maxAttempts.
 *
 * Handlers are async and should be tenant-scope-aware: every job that
 * touches per-company data MUST receive companyId via the payload or job row
 * so multi-tenant isolation isn't broken.
 */
export type JobHandler = (input: {
  payload: unknown;
  companyId: string | null;
}) => Promise<unknown>;

/**
 * Registered job types. Keep this map narrow — every entry corresponds to a
 * production handler under lib/jobs/handlers/. Adding a new type means
 * adding both the constant here and a handler in the registry.
 */
export const JOB_TYPES = {
  TRIAL_EXPIRE: "trial.expire",
  WHATSAPP_INBOUND: "whatsapp.inbound",
  // Phase 9.5 — outbound WhatsApp via the Meta Business API. Queued from
  // server actions so the UI never blocks on graph.facebook.com latency,
  // and the job-queue's retry/backoff handles transient Meta failures.
  WHATSAPP_OUTBOUND: "whatsapp.outbound",
  // Phase 9.5 risk fix — delivery callbacks (sent/delivered/read/failed)
  // from the same Meta webhook. Queued one per status event so a large
  // batch can't block the webhook handler.
  WHATSAPP_STATUS: "whatsapp.status",
  // Useful for verifying the queue end-to-end from /admin/jobs.
  TEST_ECHO: "test.echo",
} as const;

export type JobType = (typeof JOB_TYPES)[keyof typeof JOB_TYPES];
