import { requireCapability } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { ROLE_LABELS } from "@/lib/rbac";
import { toNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { Table, Td } from "@/components/ui/Table";
import { StatusBadge } from "@/components/ui/Badge";
import { CommissionRuleForm, NewUserForm } from "./SettingsForms";

export default async function SettingsPage() {
  const user = await requireCapability("manageUsers");
  const companyId = user.companyId!;

  const [users, rule] = await Promise.all([
    prisma.user.findMany({ where: { companyId }, orderBy: { createdAt: "asc" } }),
    prisma.commissionRule.findFirst({ where: { companyId, isDefault: true } }),
  ]);

  const defaults = {
    mainAgentPct: rule ? toNumber(rule.mainAgentPct) : 50,
    companyPct: rule ? toNumber(rule.companyPct) : 25,
    otherAgentPct: rule ? toNumber(rule.otherAgentPct) : 25,
    dealerPct: rule ? toNumber(rule.dealerPct) : 0,
    noOtherFallback: rule?.noOtherFallback ?? "MAIN",
  };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Configuration" title="Settings" subtitle="Manage your team and the commission rules that drive payouts." />

      {can(user.role, "setCommissionRules") && (
        <Section title="Default commission split">
          <p className="mb-4 text-sm text-muted">These percentages apply to every deal unless a property overrides them. They must total 100%.</p>
          <CommissionRuleForm defaults={defaults} />
        </Section>
      )}

      <Section title="Add a team member">
        <NewUserForm />
      </Section>

      <Section title="Users">
        <Table head={["Name", "Email", "Role", "Status"]}>
          {users.map((u) => (
            <tr key={u.id} className="hover:bg-line-soft">
              <Td className="font-medium text-ink">{u.name}</Td>
              <Td className="text-xs">{u.email}</Td>
              <Td>{ROLE_LABELS[u.role]}</Td>
              <Td><StatusBadge status={u.status} /></Td>
            </tr>
          ))}
        </Table>
      </Section>
    </div>
  );
}
