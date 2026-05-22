import type { Role } from "@prisma/client";
import type { IconName } from "@/components/ui/Icon";

export type NavGroup = "workspace" | "sales" | "field" | "finance" | "people" | "insights" | "system";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  roles: Role[];
  group?: NavGroup;
}

const ALL: Role[] = ["OWNER", "ADMIN", "AGENT", "DEALER"];
const OFFICE: Role[] = ["OWNER", "ADMIN"];

/** Sidebar items, filtered per role. Order reflects daily workflow. */
export const NAV: NavItem[] = [
  { href: "/dashboard",     label: "Dashboard",     icon: "dashboard",  roles: ALL,                          group: "workspace" },
  { href: "/properties",    label: "Properties",    icon: "home",       roles: ALL,                          group: "workspace" },
  { href: "/map",           label: "Map",           icon: "map-pin",    roles: ALL,                          group: "workspace" },

  { href: "/leads",         label: "Leads",         icon: "target",     roles: ["OWNER", "ADMIN", "AGENT"], group: "sales" },
  { href: "/deals",         label: "Deals",         icon: "exchange",   roles: ALL,                          group: "sales" },

  { href: "/calendar",      label: "Calendar",      icon: "calendar",   roles: ["OWNER", "ADMIN", "AGENT"], group: "field" },
  { href: "/visits",        label: "Visits",        icon: "flag",       roles: ["OWNER", "ADMIN", "AGENT"], group: "field" },

  { href: "/commissions",   label: "Commissions",   icon: "percent",    roles: ALL,                          group: "finance" },
  { href: "/payments",      label: "Payments",      icon: "banknote",   roles: OFFICE,                       group: "finance" },

  { href: "/agents",        label: "Agents",        icon: "users",      roles: OFFICE,                       group: "people" },
  { href: "/dealers",       label: "Dealers",       icon: "store",      roles: OFFICE,                       group: "people" },

  { href: "/documents",     label: "Documents",     icon: "document",   roles: ALL,                          group: "insights" },
  { href: "/reports",       label: "Reports",       icon: "bar-chart",  roles: OFFICE,                       group: "insights" },
  { href: "/activity",      label: "Activity log",  icon: "activity",   roles: OFFICE,                       group: "insights" },

  { href: "/notifications", label: "Notifications", icon: "bell",       roles: ALL,                          group: "system" },
  { href: "/settings",      label: "Settings",      icon: "settings",   roles: ["OWNER", "ADMIN"],          group: "system" },
];

export const GROUP_LABELS: Record<NavGroup, string> = {
  workspace: "Workspace",
  sales: "Sales",
  field: "Field",
  finance: "Finance",
  people: "People",
  insights: "Insights",
  system: "System",
};

export function navForRole(role: Role): NavItem[] {
  if (role === "SUPER_ADMIN") {
    return [{ href: "/admin/companies", label: "Companies", icon: "building", roles: ["SUPER_ADMIN"], group: "workspace" }];
  }
  return NAV.filter((item) => item.roles.includes(role));
}
