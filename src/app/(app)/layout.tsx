import { requireUser } from "@/lib/session";
import { prisma, runUnscoped } from "@/lib/prisma";
import { navForRole } from "@/lib/nav";
import { ROLE_LABELS, can } from "@/lib/rbac";
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/Topbar";
import { AgentBottomNav } from "@/components/shell/AgentBottomNav";
import { PwaSetup } from "@/components/pwa/PwaSetup";
import { Toaster } from "@/components/ui/Toaster";
import { getDict } from "@/lib/i18n/server";
import { readFlash } from "@/lib/flash";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const { locale, dict } = await getDict();

  const [company, unreadCount, flash] = await Promise.all([
    user.companyId
      ? prisma.company.findUnique({ where: { id: user.companyId }, select: { name: true } })
      : null,
    runUnscoped("notifications are per-user (userId), not company-scoped", () =>
      prisma.notification.count({ where: { userId: user.id, read: false } }),
    ),
    // Reads the flash cookie set by any recent server action so the Toaster can
    // show it; the Toaster clears the cookie client-side (render can't write it).
    readFlash(),
  ]);

  const isAgent = user.role === "AGENT";
  const roleLabel = ROLE_LABELS[user.role];

  return (
    <div className="min-h-screen bg-canvas">
      <Sidebar
        items={navForRole(user.role)}
        companyName={company?.name ?? "Platform Console"}
        roleLabel={`${roleLabel} · ${user.name}`}
        unreadCount={unreadCount}
        dict={dict}
      />
      <div className="transition-[margin] lg:ms-[var(--sidebar-w)]">
        {user.companyId && (
          <Topbar
            unreadCount={unreadCount}
            name={user.name}
            roleLabel={roleLabel}
            canManage={can(user.role, "manageUsers")}
            locale={locale}
            dict={dict}
          />
        )}
        <main className="mx-auto max-w-[1440px] px-4 py-6 pb-24 sm:px-6 lg:px-10 lg:py-8 lg:pb-10">
          {children}
        </main>
      </div>
      {isAgent && <AgentBottomNav unreadCount={unreadCount} dict={dict} />}
      <PwaSetup />
      {/* key per flash → fresh mount per message (no setState-in-effect sync). */}
      <Toaster key={flash ? `${flash.tone}:${flash.message}` : "none"} initial={flash} />
    </div>
  );
}
