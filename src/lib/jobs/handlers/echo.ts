import type { JobHandler } from "@/lib/jobs/types";

/**
 * Round-trips the payload as the result. Used by /admin/jobs to confirm the
 * queue is alive end-to-end without poking real business logic.
 */
export const echoHandler: JobHandler = async ({ payload }) => {
  return { echoed: payload ?? null, at: new Date().toISOString() };
};
