/**
 * Demo seed for the Sequences (drip nurture) feature — gives you a populated
 * sequence so the redesigned UI (overview stats, flow timeline, "currently
 * nurturing" panel) has real data to render.
 *
 * Creates one sequence "Demo: New-lead nurture" (trigger = NEW) with five steps
 * (mixed Agent-task + WhatsApp-template) and a spread of enrollments across an
 * existing company's leads: five ACTIVE at different steps with future send
 * times, plus one COMPLETED and one EXITED so every status bucket is non-empty.
 *
 * Usage:
 *
 *   DATABASE_URL="..." npx tsx scripts/seed-demo-sequence.ts [--company="Name"]
 *
 *   --company="Name"  target a specific company (matched by name). Omit to use
 *                     the company with the most leads (handy on a local DB).
 *
 * Idempotent: re-running deletes the existing "Demo: New-lead nurture" sequence
 * for that company (cascading its steps + enrollments) and recreates it fresh,
 * so it never piles up duplicates.
 *
 * ⚠️ This is a DEV / local-testing helper. The ACTIVE enrollments are future-
 * dated (so nothing fires the instant you seed), but they ARE live: once the
 * job-tick runner (`/api/jobs/tick` → runDripEnrollments) processes them they
 * advance and execute their steps — creating real follow-up tasks for agents
 * and, where WhatsApp is configured, sending real template messages to clients.
 * Don't point this at a production tenant with real clients. To remove the demo
 * afterwards, delete the sequence from its detail page (Danger zone) — that
 * cascades the steps + enrollments.
 */

import { PrismaClient, type DripStepKind, type DripEnrollmentStatus } from "@prisma/client";

const SEQUENCE_NAME = "Demo: New-lead nurture";
const HOUR_MS = 3_600_000;
/** Offset from now, in hours, as a Date. */
const at = (hours: number) => new Date(Date.now() + hours * HOUR_MS);

const STEPS: Array<{
  kind: DripStepKind;
  delayHours: number;
  templateName?: string;
  templateLang?: string;
  taskTitle?: string;
}> = [
  { kind: "TASK", delayHours: 0, taskTitle: "Call to introduce yourself" },
  { kind: "WHATSAPP_TEMPLATE", delayHours: 24, templateName: "welcome_buyer", templateLang: "en" },
  { kind: "TASK", delayHours: 48, taskTitle: "Share 3 matching listings on WhatsApp" },
  { kind: "WHATSAPP_TEMPLATE", delayHours: 72, templateName: "check_in", templateLang: "en" },
  { kind: "TASK", delayHours: 96, taskTitle: "Offer to schedule a viewing" },
];

// currentStep = the next step to run; nextRunAt staggered into the future so the
// "currently nurturing" panel shows a realistic spread of countdowns.
const ENROLLMENT_PLAN: Array<{ status: DripEnrollmentStatus; currentStep: number; nextRunAt: Date }> = [
  { status: "ACTIVE", currentStep: 0, nextRunAt: at(0.3) },
  { status: "ACTIVE", currentStep: 1, nextRunAt: at(5) },
  { status: "ACTIVE", currentStep: 2, nextRunAt: at(0.5) },
  { status: "ACTIVE", currentStep: 3, nextRunAt: at(48) },
  { status: "ACTIVE", currentStep: 1, nextRunAt: at(6) },
  { status: "COMPLETED", currentStep: STEPS.length, nextRunAt: at(-2) },
  { status: "EXITED", currentStep: 2, nextRunAt: at(-10) },
];

function parseCompanyArg(): string | null {
  const arg = process.argv.find((a) => a.startsWith("--company"));
  if (!arg) return null;
  const eq = arg.indexOf("=");
  return eq >= 0 ? arg.slice(eq + 1).trim() : null;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const wantCompany = parseCompanyArg();

    const company = wantCompany
      ? await prisma.company.findFirst({ where: { name: wantCompany }, select: { id: true, name: true } })
      : (await prisma.company.findMany({
          select: { id: true, name: true, _count: { select: { leads: true } } },
          orderBy: { leads: { _count: "desc" } },
          take: 1,
        }))[0];

    if (!company) {
      console.error(wantCompany ? `No company named "${wantCompany}".` : "No companies found — seed the DB first.");
      process.exit(1);
    }

    // Idempotent: drop any prior demo (cascade removes its steps + enrollments).
    const removed = await prisma.dripSequence.deleteMany({ where: { companyId: company.id, name: SEQUENCE_NAME } });
    if (removed.count > 0) console.log(`Removed ${removed.count} existing "${SEQUENCE_NAME}" sequence(s).`);

    const sequence = await prisma.dripSequence.create({
      data: { companyId: company.id, name: SEQUENCE_NAME, triggerStage: "NEW", active: true },
    });
    await prisma.dripStep.createMany({
      data: STEPS.map((s, order) => ({ sequenceId: sequence.id, order, ...s })),
    });

    const leads = await prisma.lead.findMany({
      where: { companyId: company.id, clientId: { not: null } },
      take: ENROLLMENT_PLAN.length,
      orderBy: { createdAt: "asc" },
      select: { id: true, client: { select: { name: true } } },
    });
    if (leads.length === 0) {
      console.error(`"${company.name}" has no leads with a linked client — can't create enrollments.`);
      process.exit(1);
    }

    let enrolled = 0;
    for (let i = 0; i < leads.length && i < ENROLLMENT_PLAN.length; i++) {
      await prisma.dripEnrollment.create({
        data: { companyId: company.id, sequenceId: sequence.id, leadId: leads[i].id, ...ENROLLMENT_PLAN[i] },
      });
      enrolled++;
    }

    const active = ENROLLMENT_PLAN.slice(0, enrolled).filter((e) => e.status === "ACTIVE").length;
    console.log("");
    console.log(`Seeded "${SEQUENCE_NAME}" into "${company.name}" (${company.id})`);
    console.log(`  steps:       ${STEPS.length}`);
    console.log(`  enrollments: ${enrolled} (${active} active, rest completed/exited)`);
    console.log(`  in flight:   ${leads.slice(0, active).map((l) => l.client?.name ?? "Unknown").join(", ")}`);
    console.log("");
    console.log("Open /sequences and click the demo to see the timeline + 'currently nurturing' panel.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
