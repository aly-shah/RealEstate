import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

interface LogInput {
  companyId: string;
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  meta?: Prisma.InputJsonValue;
}

/** Append a record to the company activity trail (requirements §22). */
export async function logActivity(input: LogInput): Promise<void> {
  await prisma.activityLog.create({
    data: {
      companyId: input.companyId,
      userId: input.userId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      summary: input.summary,
      meta: input.meta,
    },
  });
}

/** Create an in-app notification for a user. */
export async function notify(input: {
  companyId: string;
  userId: string;
  type: Prisma.NotificationCreateInput["type"];
  title: string;
  body?: string;
  link?: string;
}): Promise<void> {
  await prisma.notification.create({
    data: {
      companyId: input.companyId,
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link,
    },
  });
}
