import { requireCompanyUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { PropertyForm } from "@/components/property/PropertyForm";

export default async function NewPropertyPage() {
  const user = await requireCompanyUser();
  if (!can(user.role, "manageProperties")) redirect("/properties");

  const canPickDealer = user.role === "OWNER" || user.role === "ADMIN";
  const dealers = canPickDealer
    ? await prisma.dealer.findMany({
        where: { companyId: user.companyId },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      })
    : [];

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="Inventory" title="Add a property" subtitle="Create a new listing for the company inventory." />
      <PropertyForm dealers={dealers} canPickDealer={canPickDealer} />
    </div>
  );
}
