import type { Role } from "@prisma/client";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  roles: Role[];
}

const ALL: Role[] = ["OWNER", "ADMIN", "AGENT", "DEALER"];
const OFFICE: Role[] = ["OWNER", "ADMIN"];

/** Sidebar items, filtered per role. Order reflects daily workflow. */
export const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "▣", roles: ALL },
  { href: "/properties", label: "Properties", icon: "⌂", roles: ALL },
  { href: "/map", label: "Map", icon: "◍", roles: ALL },
  { href: "/leads", label: "Leads", icon: "◎", roles: ["OWNER", "ADMIN", "AGENT"] },
  { href: "/calendar", label: "Calendar", icon: "▦", roles: ["OWNER", "ADMIN", "AGENT"] },
  { href: "/visits", label: "Visits", icon: "⚑", roles: ["OWNER", "ADMIN", "AGENT"] },
  { href: "/deals", label: "Deals", icon: "⇄", roles: ALL },
  { href: "/commissions", label: "Commissions", icon: "%", roles: ALL },
  { href: "/payments", label: "Payments", icon: "₨", roles: OFFICE },
  { href: "/agents", label: "Agents", icon: "♟", roles: OFFICE },
  { href: "/dealers", label: "Dealers", icon: "⌗", roles: OFFICE },
  { href: "/documents", label: "Documents", icon: "▤", roles: ALL },
  { href: "/reports", label: "Reports", icon: "▤", roles: OFFICE },
  { href: "/activity", label: "Activity log", icon: "⟲", roles: OFFICE },
  { href: "/notifications", label: "Notifications", icon: "◔", roles: ALL },
  { href: "/settings", label: "Settings", icon: "⚙", roles: ["OWNER", "ADMIN"] },
];

export function navForRole(role: Role): NavItem[] {
  if (role === "SUPER_ADMIN") {
    return [{ href: "/admin/companies", label: "Companies", icon: "▤", roles: ["SUPER_ADMIN"] }];
  }
  return NAV.filter((item) => item.roles.includes(role));
}
