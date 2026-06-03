"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { enqueueJob, JOB_TYPES } from "@/lib/jobs";

async function ensureSuperAdmin() {
  const user = await requireUser();
  if (user.role !== "SUPER_ADMIN") throw new Error("Forbidden");
  return user;
}

/**
 * Re-queue a previously-failed job. Resets attempts to 0 so the runner gives
 * it a fresh full retry budget. Useful when the underlying issue (e.g. an
 * external API outage) has been fixed.
 */
export async function requeueJob(formData: FormData): Promise<void> {
  await ensureSuperAdmin();
  const id = String(formData.get("id"));
  const job = await prisma.job.findUnique({ where: { id }, select: { status: true } });
  if (!job) return;
  if (job.status !== "FAILED") return; // only retry truly-dead jobs

  await prisma.job.update({
    where: { id },
    data: {
      status: "QUEUED",
      attempts: 0,
      error: null,
      runAt: new Date(),
      startedAt: null,
      finishedAt: null,
    },
  });
  revalidatePath("/admin/jobs");
}

/**
 * Drop a job entirely. Useful for stuck/RUNNING ghosts (e.g. server crashed
 * mid-job, leaving the row claimed). Safe — the runner doesn't follow up.
 */
export async function deleteJob(formData: FormData): Promise<void> {
  await ensureSuperAdmin();
  const id = String(formData.get("id"));
  await prisma.job.delete({ where: { id } }).catch(() => null);
  revalidatePath("/admin/jobs");
}

/**
 * Smoke-test the queue end-to-end. Enqueues a `test.echo` job that the runner
 * will pick up on the next tick + persist the payload as the result.
 */
export async function enqueueEcho(): Promise<void> {
  await ensureSuperAdmin();
  await enqueueJob({
    type: JOB_TYPES.TEST_ECHO,
    companyId: null,
    payload: { from: "admin/jobs UI", at: new Date().toISOString() },
  });
  revalidatePath("/admin/jobs");
}
