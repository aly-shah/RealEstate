"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCompanyUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { logActivity } from "@/lib/activity";

const remarkSchema = z.object({
  agentId: z.string().min(1),
  remark: z.string().max(2000).optional(),
});

export type FormState = { error?: string; ok?: boolean };

/** Owner/admin saves a private remark about an agent (requirements §7). */
export async function updateAgentRemark(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireCompanyUser();
  if (!can(user.role, "manageUsers")) return { error: "Not allowed." };

  const parsed = remarkSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Invalid input." };
  const { agentId, remark } = parsed.data;

  const agent = await prisma.user.findFirst({
    where: { id: agentId, companyId: user.companyId, role: "AGENT" },
    select: { id: true },
  });
  if (!agent) return { error: "Agent not found." };

  await prisma.user.update({ where: { id: agentId }, data: { remark: remark?.trim() || null } });
  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: "agent.remark",
    entityType: "USER",
    entityId: agentId,
    summary: "Updated private remark",
  });

  revalidatePath(`/agents/${agentId}`);
  return { ok: true };
}
