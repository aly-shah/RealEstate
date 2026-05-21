import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { can, type Capability } from "@/lib/rbac";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: import("@prisma/client").Role;
  companyId: string | null;
};

/** Returns the signed-in user or redirects to /login. */
export async function requireUser(): Promise<SessionUser> {
  const session = await auth();
  if (!session?.user) redirect("/login");
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
