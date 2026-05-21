import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import { propertyScope, leadScope, dealScope } from "@/lib/scope";

export interface SearchHit {
  group: "Properties" | "Leads" | "Deals" | "Clients" | "Dealers";
  id: string;
  title: string;
  subtitle?: string;
  href: string;
}

const TAKE = 6;

/**
 * Cross-entity search, role/tenant scoped. Office roles see everything in the
 * company; agents/dealers only see what their row-level scopes allow.
 */
export async function searchAll(user: SessionUser, q: string): Promise<SearchHit[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const contains = { contains: term, mode: "insensitive" as const };
  const office = user.role === "OWNER" || user.role === "ADMIN";

  const [props, leads, deals, clients, dealers] = await Promise.all([
    prisma.property.findMany({
      where: { AND: [await propertyScope(user), { OR: [{ title: contains }, { reference: contains }, { area: contains }, { city: contains }] }] },
      select: { id: true, title: true, reference: true, area: true },
      take: TAKE,
    }),
    prisma.lead.findMany({
      where: { AND: [leadScope(user), { client: { name: contains } }] },
      select: { id: true, stage: true, client: { select: { name: true } } },
      take: TAKE,
    }),
    prisma.deal.findMany({
      where: { AND: [await dealScope(user), { OR: [{ reference: contains }, { property: { title: contains } }] }] },
      select: { id: true, reference: true, type: true, property: { select: { title: true } } },
      take: TAKE,
    }),
    // Clients & dealers are office-only.
    office
      ? prisma.client.findMany({
          where: { companyId: user.companyId!, OR: [{ name: contains }, { phone: contains }, { email: contains }] },
          select: { id: true, name: true, phone: true, leads: { select: { id: true }, take: 1 } },
          take: TAKE,
        })
      : Promise.resolve([]),
    office
      ? prisma.dealer.findMany({
          where: { companyId: user.companyId!, OR: [{ name: contains }, { companyName: contains }] },
          select: { id: true, name: true, companyName: true },
          take: TAKE,
        })
      : Promise.resolve([]),
  ]);

  const hits: SearchHit[] = [];
  for (const p of props) hits.push({ group: "Properties", id: p.id, title: p.title, subtitle: `${p.reference}${p.area ? ` · ${p.area}` : ""}`, href: `/properties/${p.id}` });
  for (const l of leads) hits.push({ group: "Leads", id: l.id, title: l.client?.name ?? "Unnamed lead", subtitle: l.stage, href: `/leads/${l.id}` });
  for (const d of deals) hits.push({ group: "Deals", id: d.id, title: d.reference, subtitle: `${d.type} · ${d.property.title}`, href: `/deals/${d.id}` });
  for (const c of clients) hits.push({ group: "Clients", id: c.id, title: c.name, subtitle: c.phone ?? undefined, href: c.leads[0] ? `/leads/${c.leads[0].id}` : "/leads" });
  for (const dl of dealers) hits.push({ group: "Dealers", id: dl.id, title: dl.name, subtitle: dl.companyName ?? undefined, href: `/dealers/${dl.id}` });
  return hits;
}
