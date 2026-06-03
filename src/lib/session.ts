import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { can, type Capability } from "@/lib/rbac";
import { getCachedUserStatus, touchUserSeen } from "@/lib/user-status";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: import("@prisma/client").Role;
  companyId: string | null;
};

/**
 * Returns the signed-in user or redirects to /login. Also re-checks the
 * underlying `User.status` (cached for 60s — see lib/user-status.ts) so a
 * SUSPENDED user with a still-valid JWT can't keep using the app. SUPER_ADMIN
 * is exempt: their account lives outside any tenant and the suspension
 * workflow doesn't apply.
 */
export async function requireUser(): Promise<SessionUser> {
  const session = await auth();
  if (!session?.user) redirect("/login");

  if (session.user.role !== "SUPER_ADMIN") {
    const status = await getCachedUserStatus(session.user.id);
    if (status !== "ACTIVE") {
      // status === null  -> user was deleted while session lived
      // status === SUSPENDED -> account was suspended after sign-in
      // status === INVITED  -> placeholder for invite-flow accounts (not allowed in app yet)
      redirect("/login?reason=suspended");
    }
  }

  // Stamp lastSeenAt (throttled to 1/min/user). Fire-and-forget — never blocks
  // the request. SUPER_ADMINs get tracked too; their dormancy is also useful.
  touchUserSeen(session.user.id);

  return session.user;
}

/**
 * Returns a user guaranteed to belong to a company. Super admins are bounced
 * to the platform console since the company-scoped screens need a companyId.
 */
export async function requireCompanyUser(): Promise<SessionUser & { companyId: string }> {
  const user = await requireUser();
  if (!user.companyId) redirect("/admin/companies");
  return user as SessionUser & { companyId: string };
}

export async function requireCapability(capability: Capability): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user.role, capability)) redirect("/dashboard");
  return user;
}

/** True when an agent/dealer should be limited to their own records. */
export function isScopedToSelf(role: SessionUser["role"]): boolean {
  return role === "AGENT" || role === "DEALER";
}
