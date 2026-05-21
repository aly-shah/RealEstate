import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { toCsv, csvResponse } from "@/lib/csv";
import { toNumber } from "@/lib/format";
import { agentLeaderboard } from "@/lib/metrics";

/** GET /api/export?type=agents|deals|payments|properties|leads|commissions */
export async function GET(req: NextRequest) {
  const session = await auth();
  const user = session?.user;
  if (!user?.companyId || !can(user.role, "viewCompanyReports")) {
    return new Response("Forbidden", { status: 403 });
  }
  const companyId = user.companyId;
  const type = req.nextUrl.searchParams.get("type") ?? "deals";

  switch (type) {
    case "agents": {
      const board = await agentLeaderboard(companyId);
      return csvResponse(
        "agents.csv",
        toCsv(
          ["Rank", "Agent", "Deals won", "Revenue", "Leads", "Conversion %"],
          board.map((a, i) => [i + 1, a.name, a.dealsWon, a.revenue, a.leads, a.conversion]),
        ),
      );
    }
    case "deals": {
      const deals = await prisma.deal.findMany({
        where: { companyId },
        include: { property: true, client: true, sale: true, rental: true },
        orderBy: { createdAt: "desc" },
      });
      return csvResponse(
        "deals.csv",
        toCsv(
          ["Reference", "Type", "Status", "Property", "Client", "Value", "Closed"],
          deals.map((d) => [
            d.reference, d.type, d.status, d.property.title, d.client?.name ?? "",
            toNumber(d.sale?.salePrice ?? d.rental?.monthlyRent),
            d.closeDate ? d.closeDate.toISOString().slice(0, 10) : "",
          ]),
        ),
      );
    }
    case "payments": {
      const payments = await prisma.payment.findMany({
        where: { companyId },
        include: { deal: { include: { client: true } } },
        orderBy: { createdAt: "desc" },
      });
      return csvResponse(
        "payments.csv",
        toCsv(
          ["Type", "Deal", "Client", "Amount", "Status", "Due", "Paid"],
          payments.map((p) => [
            p.type, p.deal?.reference ?? "", p.deal?.client?.name ?? "", toNumber(p.amount), p.status,
            p.dueDate ? p.dueDate.toISOString().slice(0, 10) : "",
            p.paidAt ? p.paidAt.toISOString().slice(0, 10) : "",
          ]),
        ),
      );
    }
    case "properties": {
      const props = await prisma.property.findMany({ where: { companyId }, orderBy: { createdAt: "desc" } });
      return csvResponse(
        "properties.csv",
        toCsv(
          ["Reference", "Title", "Type", "Status", "City", "Area", "Sale price", "Monthly rent"],
          props.map((p) => [p.reference, p.title, p.type, p.status, p.city ?? "", p.area ?? "", toNumber(p.salePrice), toNumber(p.monthlyRent)]),
        ),
      );
    }
    case "leads": {
      const leads = await prisma.lead.findMany({ where: { companyId }, include: { client: true, agent: true }, orderBy: { createdAt: "desc" } });
      return csvResponse(
        "leads.csv",
        toCsv(
          ["Client", "Stage", "Source", "Agent", "Lost reason", "Created"],
          leads.map((l) => [l.client?.name ?? "", l.stage, l.source, l.agent?.name ?? "", l.lostReason ?? "", l.createdAt.toISOString().slice(0, 10)]),
        ),
      );
    }
    case "commissions": {
      const shares = await prisma.commissionShare.findMany({
        where: { commission: { companyId } },
        include: { commission: { include: { deal: true } } },
      });
      return csvResponse(
        "commissions.csv",
        toCsv(
          ["Deal", "Party", "Label", "Percent", "Amount", "Paid"],
          shares.map((s) => [s.commission.deal.reference, s.party, s.label, toNumber(s.pct), toNumber(s.amount), s.paid ? "Yes" : "No"]),
        ),
      );
    }
    default:
      return new Response("Unknown export type", { status: 400 });
  }
}
