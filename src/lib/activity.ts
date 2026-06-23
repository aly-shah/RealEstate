import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { clientIp, userAgent } from "@/lib/request-meta";
import { publish } from "@/lib/realtime";

interface LogInput {
  companyId: string;
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  meta?: Prisma.InputJsonValue;
}

/**
 * Read request-scoped metadata (IP, UA, actor role). Returns null on any
 * failure — useful for non-HTTP call sites like seed scripts.
 */
async function captureActor(userId: string | null | undefined): Promise<{
  ip: string;
  ua: string | null;
  role: string | null;
} | null> {
  try {
    const [ip, ua, session] = await Promise.all([clientIp(), userAgent(), auth()]);
    // Only trust the session role when it belongs to the actor we're logging.
    const role = session?.user && session.user.id === userId ? session.user.role : null;
    return { ip, ua, role };
  } catch {
    return null;
  }
}

/** Append a record to the company activity trail (requirements §22). */
export async function logActivity(input: LogInput): Promise<void> {
  // Auto-enrich with request context. Existing callers don't pass these and
  // shouldn't need to — keeps PR diffs small while widening the audit trail.
  const actor = await captureActor(input.userId);
  const meta = actor
    ? { ...((input.meta as Record<string, unknown>) ?? {}), _actor: actor }
    : input.meta;

  await prisma.activityLog.create({
    data: {
      companyId: input.companyId,
      userId: input.userId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      summary: input.summary,
      meta: meta as Prisma.InputJsonValue | undefined,
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
  const row = await prisma.notification.create({
    data: {
      companyId: input.companyId,
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link,
    },
    select: { id: true },
  });
  // Push to the user's open tabs in real time (best-effort; never throws).
  await publish({
    userId: input.userId,
    companyId: input.companyId,
    id: row.id,
    type: String(input.type),
    title: input.title,
    link: input.link ?? null,
  });
}
