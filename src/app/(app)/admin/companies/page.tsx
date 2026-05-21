import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { StatCard } from "@/components/ui/StatCard";
import { Table, Td } from "@/components/ui/Table";
import { StatusBadge } from "@/components/ui/Badge";
import { CompanyForm } from "./CompanyForm";
import { setCompanyStatus } from "./actions";

export default async function CompaniesPage() {
  const user = await requireUser();
  if (user.role !== "SUPER_ADMIN") redirect("/dashboard");

  const companies = await prisma.company.findMany({
    include: { _count: { select: { users: true, properties: true, deals: true } } },
    orderBy: { createdAt: "desc" },
  });

  const totalUsers = companies.reduce((s, c) => s + c._count.users, 0);
  const active = companies.filter((c) => c.status === "ACTIVE").length;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Platform console" title="Companies" subtitle="Every business account on the platform." />

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Companies" value={companies.length} tone="ink" />
        <StatCard label="Active" value={active} tone="accent" />
        <StatCard label="Total users" value={totalUsers} />
      </div>

      <Section title="Onboard a new company">
        <CompanyForm />
      </Section>

      <Section title="All companies">
        <Table head={["Company", "Plan", "Users", "Properties", "Deals", "Created", "Status", ""]}>
          {companies.map((c) => (
            <tr key={c.id} className="hover:bg-line-soft">
              <Td className="font-medium text-ink">{c.name}</Td>
              <Td className="text-xs">{c.plan}</Td>
              <Td>{c._count.users}</Td>
              <Td>{c._count.properties}</Td>
              <Td>{c._count.deals}</Td>
              <Td className="text-xs text-muted">{fmtDate(c.createdAt)}</Td>
              <Td><StatusBadge status={c.status} /></Td>
              <Td>
                <form action={setCompanyStatus}>
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="status" value={c.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE"} />
                  <button className="btn-ghost px-2 py-1 text-xs">{c.status === "ACTIVE" ? "Suspend" : "Activate"}</button>
                </form>
              </Td>
            </tr>
          ))}
        </Table>
      </Section>
    </div>
  );
}
