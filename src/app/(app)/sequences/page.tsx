import Link from "next/link";
import { requireCapability } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { humanize } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { Table, Td } from "@/components/ui/Table";
import { StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { CreateSequenceForm } from "./SequenceForms";

export default async function SequencesPage() {
  const user = await requireCapability("assignLeadsCalendars");
  const companyId = user.companyId!;

  const sequences = await prisma.dripSequence.findMany({
    where: { companyId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      triggerStage: true,
      active: true,
      _count: { select: { steps: true, enrollments: true } },
    },
  });

  return (
    <div>
      <PageHeader
        eyebrow="Automation"
        title="Sequences"
        subtitle="Multi-step nurture campaigns — leads enrol automatically when they reach the trigger stage."
      />

      <Section title="New sequence">
        <CreateSequenceForm />
      </Section>

      <Section title="All sequences">
        {sequences.length === 0 ? (
          <EmptyState title="No sequences yet" hint="Create one above to start automating follow-up." />
        ) : (
          <Table head={["Name", "Trigger", "Steps", "Enrolled", "Status", ""]}>
            {sequences.map((s) => (
              <tr key={s.id} className="hover:bg-line-soft">
                <Td>
                  <Link href={`/sequences/${s.id}`} className="font-medium text-ink hover:text-accent">{s.name}</Link>
                </Td>
                <Td className="text-xs">{s.triggerStage ? humanize(s.triggerStage) : <span className="text-muted">Manual</span>}</Td>
                <Td>{s._count.steps}</Td>
                <Td>{s._count.enrollments}</Td>
                <Td>
                  {s.active
                    ? <StatusBadge status="ACTIVE" />
                    : <span className="chip border-line bg-line-soft text-slate">Draft</span>}
                </Td>
                <Td><Link href={`/sequences/${s.id}`} className="text-xs font-semibold text-accent">Edit →</Link></Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </div>
  );
}
