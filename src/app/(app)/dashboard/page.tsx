import { requireCompanyUser } from "@/lib/session";
import { OwnerDashboard } from "@/components/dashboards/OwnerDashboard";
import { AdminDashboard } from "@/components/dashboards/AdminDashboard";
import { AgentDashboard } from "@/components/dashboards/AgentDashboard";
import { DealerDashboard } from "@/components/dashboards/DealerDashboard";

export default async function DashboardPage() {
  const user = await requireCompanyUser();

  switch (user.role) {
    case "OWNER":
      return <OwnerDashboard companyId={user.companyId} />;
    case "ADMIN":
      return <AdminDashboard companyId={user.companyId} />;
    case "AGENT":
      return <AgentDashboard companyId={user.companyId} userId={user.id} name={user.name} />;
    case "DEALER":
      return <DealerDashboard companyId={user.companyId} userId={user.id} />;
    default:
      return null;
  }
}
