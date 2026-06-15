import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { notify, logActivity } from "@/lib/activity";
import { fmtDateTime } from "@/lib/format";
import { clientIp } from "@/lib/request-meta";
import { rateLimit, formatRetryAfter } from "@/lib/rate-limit";

export const runtime = "nodejs";

const MIN_LEAD_MINUTES = 30;
const MAX_DAYS_AHEAD = 90;

/**
 * POST /api/public/portal-booking   { token, propertyId, startAt }
 *
 * Self-serve viewing request from the login-free client portal. Authorises by
 * the portal token, confirms the property is in the client's shortlist via one
 * of their leads (which also gives us the agent to assign), then books a
 * SCHEDULED `SHOWING` CalendarEvent and notifies the agent (or the office, if
 * the lead is unassigned). The event surfaces straight back in the portal's
 * "Upcoming appointments" list.
 *
 * Sits under /api/public/ so the proxy auth gate (src/proxy.ts) doesn't bounce
 * the anonymous client to /login. Defensive: rate-limited per IP, the time is
 * range-checked, and one open request per lead+property is enforced.
 */
export async function POST(req: Request) {
  const ip = await clientIp();
  const limited = rateLimit({ key: `portal-booking:ip:${ip}`, limit: 8, windowMs: 60_000 });
  if (!limited.allowed) {
    return NextResponse.json(
      { error: `Too many requests. Try again in ${formatRetryAfter(limited.retryAfterMs)}.` },
      { status: 429 },
    );
  }

  let body: { token?: string; propertyId?: string; startAt?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const token = String(body.token ?? "");
  const propertyId = String(body.propertyId ?? "");
  const startAtRaw = String(body.startAt ?? "");
  if (!token || !propertyId || !startAtRaw) {
    return NextResponse.json({ error: "Missing booking details." }, { status: 400 });
  }

  const startAt = new Date(startAtRaw);
  const now = Date.now();
  if (Number.isNaN(startAt.getTime())) {
    return NextResponse.json({ error: "Pick a valid date and time." }, { status: 400 });
  }
  if (startAt.getTime() < now + MIN_LEAD_MINUTES * 60_000) {
    return NextResponse.json({ error: `Please choose a time at least ${MIN_LEAD_MINUTES} minutes from now.` }, { status: 400 });
  }
  if (startAt.getTime() > now + MAX_DAYS_AHEAD * 86_400_000) {
    return NextResponse.json({ error: `Please choose a time within ${MAX_DAYS_AHEAD} days.` }, { status: 400 });
  }

  // 1. Resolve the client from the unguessable portal token.
  const client = await prisma.client.findFirst({
    where: { portalToken: token, portalEnabled: true },
    select: { id: true, companyId: true, name: true },
  });
  if (!client) return NextResponse.json({ error: "This portal link is no longer active." }, { status: 404 });

  // 2. The property must be in the client's shortlist via one of their leads —
  //    that lead also tells us which agent to assign the viewing to.
  const lead = await prisma.lead.findFirst({
    where: { companyId: client.companyId, clientId: client.id, propertyId },
    select: { id: true, agentId: true },
  });
  if (!lead) return NextResponse.json({ error: "This property isn't available to book." }, { status: 404 });

  const property = await prisma.property.findFirst({
    where: { id: propertyId, companyId: client.companyId },
    select: { reference: true, title: true },
  });
  if (!property) return NextResponse.json({ error: "Property not found." }, { status: 404 });

  // 3. One open viewing request per lead+property — guards against double-submit.
  const existing = await prisma.calendarEvent.findFirst({
    where: { leadId: lead.id, propertyId, type: "SHOWING", status: "SCHEDULED", startAt: { gt: new Date() } },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json(
      { error: "You already have a viewing requested for this property — your agent will confirm the time." },
      { status: 409 },
    );
  }

  const label = property.title || property.reference || "your shortlisted property";

  await prisma.calendarEvent.create({
    data: {
      companyId: client.companyId,
      agentId: lead.agentId, // null → office is notified instead
      leadId: lead.id,
      propertyId,
      type: "SHOWING",
      status: "SCHEDULED",
      title: `Viewing requested by ${client.name}`,
      notes: "Requested via the client portal.",
      startAt,
    },
  });

  // 4. Notify the lead's agent, or the office owners/admins if it's unassigned.
  const recipients = lead.agentId
    ? [lead.agentId]
    : (
        await prisma.user.findMany({
          where: { companyId: client.companyId, role: { in: ["OWNER", "ADMIN"] }, status: "ACTIVE" },
          select: { id: true },
        })
      ).map((u) => u.id);

  await Promise.all(
    recipients.map((userId) =>
      notify({
        companyId: client.companyId,
        userId,
        type: "GENERAL",
        title: "Viewing requested",
        body: `${client.name} requested a viewing of ${label} on ${fmtDateTime(startAt)}.`,
        link: `/leads/${lead.id}`,
      }),
    ),
  );

  await logActivity({
    companyId: client.companyId,
    action: "showing.requested",
    entityType: "LEAD",
    entityId: lead.id,
    summary: `${client.name} requested a viewing of ${label} via the portal`,
    meta: { propertyId, startAt: startAt.toISOString(), source: "PORTAL" },
  });

  return NextResponse.json({ ok: true });
}
