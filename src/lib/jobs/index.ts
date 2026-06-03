import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { JobType } from "./types";

export { JOB_TYPES } from "./types";
export type { JobType } from "./types";
export { runDueJobs } from "./runner";

export interface EnqueueInput {
  type: JobType | string;
  payload?: unknown;
  companyId?: string | null;
  /** When the job should first become eligible to run. Defaults to now. */
  runAt?: Date;
  /** Override the default retry budget (3). */
  maxAttempts?: number;
  /**
   * Producer-supplied dedup key. When set, a second enqueue with the same
   * `(type, idempotencyKey)` returns the original job id instead of inserting
   * a duplicate — designed for webhook retries (Meta resends inbound WhatsApp
   * messages on timeout). NULL repeats freely.
   */
  idempotencyKey?: string | null;
}

/**
 * Insert a new QUEUED job. Returns the job id so producers can correlate.
 * When `idempotencyKey` is set, a P2002 from the `@@unique([type, idempotencyKey])`
 * constraint is caught and the existing row's id is returned — webhook
 * handlers can blindly enqueue without worrying about double-processing.
 */
export async function enqueueJob(input: EnqueueInput): Promise<string> {
  try {
    const job = await prisma.job.create({
      data: {
        type: input.type,
        companyId: input.companyId ?? null,
        payload: (input.payload ?? null) as Parameters<typeof prisma.job.create>[0]["data"]["payload"],
        runAt: input.runAt ?? new Date(),
        maxAttempts: input.maxAttempts ?? 3,
        idempotencyKey: input.idempotencyKey ?? null,
      },
      select: { id: true },
    });
    return job.id;
  } catch (e) {
    if (
      input.idempotencyKey &&
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      // Dedup hit — look up the existing row and return its id so callers
      // don't have to special-case "was this a fresh enqueue or a repeat?"
      const existing = await prisma.job.findUnique({
        where: { type_idempotencyKey: { type: input.type, idempotencyKey: input.idempotencyKey } },
        select: { id: true },
      });
      if (existing) return existing.id;
    }
    throw e;
  }
}
