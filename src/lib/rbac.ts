import type { Role } from "@prisma/client";

/**
 * Capability map mirrors the permission matrix in requirements §3.
 * Each capability lists the roles allowed to perform it. "own"-scoped checks
 * (e.g. an agent only seeing their own leads) are enforced at the query level.
 */
export const CAPABILITIES = {
  manageCompanies: ["SUPER_ADMIN"],
  manageUsers: ["SUPER_ADMIN", "OWNER", "ADMIN"],
  manageProperties: ["SUPER_ADMIN", "OWNER", "ADMIN", "AGENT", "DEALER"],
  assignLeadsCalendars: ["SUPER_ADMIN", "OWNER", "ADMIN"],
  updateLeadsVisits: ["SUPER_ADMIN", "OWNER", "ADMIN", "AGENT"],
  recordDeals: ["SUPER_ADMIN", "OWNER", "ADMIN"],
  setCommissionRules: ["SUPER_ADMIN", "OWNER"],
  approveCommission: ["SUPER_ADMIN", "OWNER", "ADMIN"],
  viewCompanyReports: ["SUPER_ADMIN", "OWNER", "ADMIN"],
  managePayments: ["SUPER_ADMIN", "OWNER", "ADMIN"],
  manageDocuments: ["SUPER_ADMIN", "OWNER", "ADMIN", "AGENT", "DEALER"],
} as const;

export type Capability = keyof typeof CAPABILITIES;

export function can(role: Role, capability: Capability): boolean {
  return (CAPABILITIES[capability] as readonly Role[]).includes(role);
}

/** Roles that operate inside a single company (everyone except the provider). */
export const COMPANY_ROLES: Role[] = ["OWNER", "ADMIN", "AGENT", "DEALER"];

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Super Admin",
  OWNER: "Owner",
  ADMIN: "Admin",
  AGENT: "Agent",
  DEALER: "Dealer",
};

/** Where each role lands after login. */
export function homePathForRole(role: Role): string {
  if (role === "SUPER_ADMIN") return "/admin/companies";
  return "/dashboard";
}
