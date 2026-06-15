import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { sendWhatsAppTemplate } from "@/lib/wa-business";

/**
 * Drip-sequence engine.
 *
 * - enrollLeadInSequences: called from lead create / stage-advance. Enrolls the
 *   lead into every active sequence whose triggerStage matches the lead's new
 *   stage (deduped by the unique [sequenceId, leadId]).
 * - runDripEnrollments: a sweep (job tick) that executes every ACTIVE enrollment
 *   whose currentStep is due, then advances it. WhatsApp steps are consent-gated
 *   (Client.marketingOptOut) and only deliver via approved templates; TASK steps
 *   create a follow-up for the lead's agent.
 *
 * Both are best-effort and tenant-safe; the runner is bounded per tick.
 */

const CLOSED_STAGES = ["CLOSED_WON", "CLOSED_LOST"];
const RUN_BATCH = 200;
const MS_PER_HOUR = 3_600_000;

/** Enroll a lead into the sequences triggered by its current stage. Returns the
 *  number of new enrollments created. Never throws into the caller. */
export async function enrollLeadInSequences(leadId: string): Promise<number> {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, companyId: true, stage: true },
    });
    if (!lead || CLOSED_STAGES.includes(lead.stage)) return 0;

    const sequences = await prisma.dripSequence.findMany({
      where: { companyId: lead.companyId, active: true, triggerStage: lead.stage },
      select: { id: true, steps: { orderBy: { order: "asc" }, take: 1, select: { delayHours: true } } },
    });

    let enrolled = 0;
    for (const seq of sequences) {
      if (seq.steps.length === 0) continue; // empty sequence — nothing to schedule
      const firstDelayMs = Math.max(0, seq.steps[0].delayHours) * MS_PER_HOUR;
      try {
        await prisma.dripEnrollment.create({
          data: {
            companyId: lead.companyId,
            sequenceId: seq.id,
            leadId: lead.id,
            currentStep: 0,
            nextRunAt: new Date(Date.now() + firstDelayMs),
          },
        });
        enrolled += 1;
      } catch {
        // P2002 on the unique [sequenceId, leadId] → already enrolled; skip.
      }
    }
    return enrolled;
  } catch (err) {
    console.error(`[drip] enrollLeadInSequences ${leadId} failed:`, err);
    return 0;
  }
}

export interface DripRunResult {
  /** Due enrollments inspected this run. */
  processed: number;
  /** Steps actually executed (a WhatsApp send or task created). */
  executed: number;
  /** Enrollments that completed or exited this run. */
  finished: number;
}

/** Execute every due ACTIVE enrollment and advance it. Bounded per run. */
export async function runDripEnrollments(): Promise<DripRunResult> {
  const due = await prisma.dripEnrollment.findMany({
    where: { status: "ACTIVE", nextRunAt: { lte: new Date() } },
    select: {
      id: true,
      companyId: true,
      leadId: true,
      currentStep: true,
      lead: {
        select: {
          stage: true,
          agentId: true,
          client: { select: { name: true, phone: true, marketingOptOut: true } },
        },
      },
      sequence: {
        select: {
          steps: {
            orderBy: { order: "asc" },
            select: { kind: true, delayHours: true, templateName: true, templateLang: true, taskTitle: true },
          },
        },
      },
    },
    take: RUN_BATCH,
  });
  if (due.length === 0) return { processed: 0, executed: 0, finished: 0 };

  // Cache decrypted WhatsApp creds per company across the batch.
  const credsCache = new Map<string, { phoneNumberId: string; accessToken: string } | null>();
  const companyCreds = async (companyId: string) => {
    if (credsCache.has(companyId)) return credsCache.get(companyId)!;
    const co = await prisma.company.findUnique({
      where: { id: companyId },
      select: { whatsappPhoneId: true, whatsappAccessToken: true },
    });
    const token = decryptSecret(co?.whatsappAccessToken);
    const creds = co?.whatsappPhoneId && token ? { phoneNumberId: co.whatsappPhoneId, accessToken: token } : null;
    credsCache.set(companyId, creds);
    return creds;
  };

  let executed = 0;
  let finished = 0;

  for (const e of due) {
    // Exit if the lead closed since enrollment.
    if (CLOSED_STAGES.includes(e.lead.stage)) {
      await prisma.dripEnrollment.update({ where: { id: e.id }, data: { status: "EXITED" } });
      finished += 1;
      continue;
    }

    const steps = e.sequence.steps;
    const step = steps[e.currentStep];
    if (!step) {
      await prisma.dripEnrollment.update({ where: { id: e.id }, data: { status: "COMPLETED" } });
      finished += 1;
      continue;
    }

    // Execute the current step (best-effort — a send failure still advances the
    // enrollment so one bad step doesn't wedge the whole sequence).
    try {
      if (step.kind === "TASK") {
        if (e.lead.agentId) {
          await prisma.calendarEvent.create({
            data: {
              companyId: e.companyId,
              agentId: e.lead.agentId,
              leadId: e.leadId,
              type: "FOLLOW_UP",
              status: "SCHEDULED",
              title: step.taskTitle || "Follow up",
              startAt: new Date(Date.now() + MS_PER_HOUR),
            },
          });
          executed += 1;
        }
      } else if (step.kind === "WHATSAPP_TEMPLATE" && step.templateName && step.templateLang) {
        const phone = e.lead.client?.phone;
        const optedOut = e.lead.client?.marketingOptOut ?? false;
        const creds = await companyCreds(e.companyId);
        if (phone && !optedOut && creds) {
          const res = await sendWhatsAppTemplate({
            phoneNumberId: creds.phoneNumberId,
            accessToken: creds.accessToken,
            toPhone: phone,
            templateName: step.templateName,
            language: step.templateLang,
            bodyParams: [e.lead.client?.name ?? "there"],
          });
          if (res.ok) executed += 1;
        }
      }
    } catch (err) {
      console.error(`[drip] step ${e.currentStep} of enrollment ${e.id} failed:`, err);
    }

    // Advance.
    const nextIndex = e.currentStep + 1;
    if (nextIndex >= steps.length) {
      await prisma.dripEnrollment.update({ where: { id: e.id }, data: { status: "COMPLETED", currentStep: nextIndex } });
      finished += 1;
    } else {
      await prisma.dripEnrollment.update({
        where: { id: e.id },
        data: { currentStep: nextIndex, nextRunAt: new Date(Date.now() + Math.max(0, steps[nextIndex].delayHours) * MS_PER_HOUR) },
      });
    }
  }

  return { processed: due.length, executed, finished };
}

/** Stop all active sequences for a lead (e.g. on opt-out or manual removal). */
export async function exitLeadFromSequences(leadId: string): Promise<number> {
  const { count } = await prisma.dripEnrollment.updateMany({
    where: { leadId, status: "ACTIVE" },
    data: { status: "EXITED" },
  });
  return count;
}
