import { requireCapability } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { LeadForm } from "./LeadForm";

export default async function NewLeadPage() {
  const user = await requireCapability("updateLeadsVisits");
  const isOffice = user.role === "OWNER" || user.role === "ADMIN";

  const [agents, properties] = await Promise.all([
    isOffice
      ? prisma.user.findMany({ where: { companyId: user.companyId!, role: "AGENT" }, select: { id: true, name: true } })
      : Promise.resolve([]),
    prisma.property.findMany({
      where: { companyId: user.companyId!, status: { in: ["AVAILABLE", "UNDER_NEGOTIATION", "RESERVED"] } },
      select: { id: true, title: true, reference: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader eyebrow="CRM" title="Capture a lead" subtitle="Record a new enquiry and start the pipeline." />
      <LeadForm agents={agents} properties={properties} canAssign={isOffice} />
    </div>
  );
}
