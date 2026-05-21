import { redirect } from "next/navigation";
import { requireCompanyUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { DealForm } from "./DealForm";

export default async function NewDealPage() {
  const user = await requireCompanyUser();
  if (!can(user.role, "recordDeals")) redirect("/deals");

  const [properties, clients, agents, dealers, rule] = await Promise.all([
    prisma.property.findMany({ where: { companyId: user.companyId }, select: { id: true, title: true, reference: true }, orderBy: { createdAt: "desc" }, take: 300 }),
    prisma.client.findMany({ where: { companyId: user.companyId }, select: { id: true, name: true }, take: 300 }),
    prisma.user.findMany({ where: { companyId: user.companyId, role: "AGENT" }, select: { id: true, name: true } }),
    prisma.dealer.findMany({ where: { companyId: user.companyId }, select: { id: true, name: true } }),
    prisma.commissionRule.findFirst({ where: { companyId: user.companyId, isDefault: true } }),
  ]);

  const ruleDefaults = {
    mainAgentPct: rule ? toNumber(rule.mainAgentPct) : 50,
    companyPct: rule ? toNumber(rule.companyPct) : 25,
    otherAgentPct: rule ? toNumber(rule.otherAgentPct) : 25,
    dealerPct: rule ? toNumber(rule.dealerPct) : 0,
    noOtherFallback: (rule?.noOtherFallback === "COMPANY" ? "COMPANY" : "MAIN") as "MAIN" | "COMPANY",
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader eyebrow="Transactions" title="Record a deal" subtitle="Capture a sale or rental, its money and the agents involved." />
      <DealForm properties={properties} clients={clients} agents={agents} dealers={dealers} rule={ruleDefaults} />
    </div>
  );
}
