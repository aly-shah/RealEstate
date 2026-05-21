import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/session";
import { toNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Table, Td } from "@/components/ui/Table";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/Badge";

export default async function DealersPage() {
  const user = await requireCapability("manageUsers");

  const dealers = await prisma.dealer.findMany({
    where: { companyId: user.companyId! },
    include: {
      _count: { select: { properties: true, deals: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <PageHeader
        eyebrow="Network"
        title="Dealers"
        subtitle="Inventory suppliers, their share and what each contributes."
        action={<Link href="/dealers/new" className="btn-accent">+ Add dealer</Link>}
      />

      {dealers.length === 0 ? (
        <EmptyState title="No dealers yet" hint="Add the suppliers who bring or hold inventory." />
      ) : (
        <Table head={["Dealer", "Area", "Share", "Inventory", "Deals", "Status"]}>
          {dealers.map((d) => (
            <tr key={d.id} className="hover:bg-line-soft">
              <Td>
                <Link href={`/dealers/${d.id}`} className="font-medium text-ink hover:text-accent">{d.name}</Link>
                <div className="text-xs text-muted">{d.companyName ?? d.contact ?? "—"}</div>
              </Td>
              <Td>{d.areaOfOperation ?? "—"}</Td>
              <Td>{toNumber(d.defaultSharePct)}%</Td>
              <Td>{d._count.properties}</Td>
              <Td>{d._count.deals}</Td>
              <Td><StatusBadge status={d.status} /></Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
