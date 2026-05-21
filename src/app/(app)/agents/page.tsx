import Link from "next/link";
import { requireCapability } from "@/lib/session";
import { agentLeaderboard } from "@/lib/metrics";
import { compactMoney } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Table, Td } from "@/components/ui/Table";
import { EmptyState } from "@/components/ui/EmptyState";

export default async function AgentsPage() {
  const user = await requireCapability("viewCompanyReports");
  const board = await agentLeaderboard(user.companyId!);

  return (
    <div>
      <PageHeader
        eyebrow="Team"
        title="Agents & leaderboard"
        subtitle="Activity turned into numbers — reward top performers, coach the rest."
      />

      {board.length === 0 ? (
        <EmptyState title="No agents yet" hint="Add agents from Settings → Users." />
      ) : (
        <Table head={["#", "Agent", "Deals won", "Revenue", "Leads", "Conversion"]}>
          {board.map((a, i) => (
            <tr key={a.id} className="hover:bg-line-soft">
              <Td className="font-extrabold text-accent">{i + 1}</Td>
              <Td>
                <Link href={`/agents/${a.id}`} className="font-medium text-ink hover:text-accent">{a.name}</Link>
              </Td>
              <Td>{a.dealsWon}</Td>
              <Td className="font-semibold text-ink">{compactMoney(a.revenue)}</Td>
              <Td>{a.leads}</Td>
              <Td>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-20 overflow-hidden rounded-full bg-line">
                    <div className="h-full bg-accent" style={{ width: `${Math.min(a.conversion, 100)}%` }} />
                  </div>
                  <span className="text-xs text-muted">{a.conversion}%</span>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
