import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";

/**
 * Builds a Prisma `where` fragment that restricts Property queries to what a
 * user may see: office roles see the whole company; agents see only properties
 * assigned to them; dealers see only their own inventory.
 */
export async function propertyScope(
  user: SessionUser,
): Promise<Prisma.PropertyWhereInput> {
  const base: Prisma.PropertyWhereInput = { companyId: user.companyId! };
  if (user.role === "AGENT") {
    return { ...base, agents: { some: { agentId: user.id } } };
  }
  if (user.role === "DEALER") {
    const dealer = await prisma.dealer.findFirst({
      where: { companyId: user.companyId!, userId: user.id },
      select: { id: true },
    });
    return { ...base, dealerId: dealer?.id ?? "__none__" };
  }
  return base;
}

/** Lead scope: agents see only their own assigned leads. */
export function leadScope(user: SessionUser): Prisma.LeadWhereInput {
  const base: Prisma.LeadWhereInput = { companyId: user.companyId! };
  if (user.role === "AGENT") return { ...base, agentId: user.id };
  return base;
}

/** Deal scope: agents/dealers see only deals they are linked to. */
export async function dealScope(user: SessionUser): Promise<Prisma.DealWhereInput> {
  const base: Prisma.DealWhereInput = { companyId: user.companyId! };
  if (user.role === "AGENT") return { ...base, agents: { some: { agentId: user.id } } };
  if (user.role === "DEALER") {
    const dealer = await prisma.dealer.findFirst({
      where: { companyId: user.companyId!, userId: user.id },
      select: { id: true },
    });
    return { ...base, dealerId: dealer?.id ?? "__none__" };
  }
  return base;
}
