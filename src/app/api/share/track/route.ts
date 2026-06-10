import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/activity";
import { clientIp, userAgent } from "@/lib/request-meta";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

// A client is flagged "high intent" once they rack up this many views on a
// single listing. The alert fires once — on the view that crosses the line —
// so the assigned agent isn't spammed on every subsequent view.
const HIGH_INTENT_THRESHOLD = 4;

/** No-content response — telemetry never leaks state to the (public) caller. */
const noContent = () => new NextResponse(null, { status: 204 });

/**
 * Salted SHA-256 of the viewer IP. Salting with AUTH_SECRET makes the digest
 * non-reversible and rainbow-table-resistant, so we get repeat-view detection
 * without ever storing the raw address.
 */
function hashIp(ip: string): string {
  return createHash("sha256")
    .update(`${process.env.AUTH_SECRET ?? ""}:${ip}`)
    .digest("hex");
}

/**
 * POST /api/share/track — record a view of a public share page.
 *
 * Unauthenticated by design (the page is public), so it's defensive:
 *   - rate-limited per IP,
 *   - only tracks listings whose share link is actually enabled (resolved
 *     server-side from the slug — the client can't fabricate a propertyId),
 *   - stores only a salted IP hash, never the raw address,
 *   - validates any supplied clientId against the listing's tenant.
 *
 * The whole body is wrapped so a telemetry failure always returns 204 and never
 * surfaces an error to the public visitor.
 */
export async function POST(req: Request) {
  try {
    // 1. Rate-limit by IP — cheap flood protection on an unauthenticated route.
    const ip = await clientIp();
    const limited = rateLimit({ key: `share-track:ip:${ip}`, limit: 30, windowMs: 60_000 });
    if (!limited.allowed) return noContent();

    // 2. Parse the body — { slug, clientId? }. Malformed JSON → silent 204.
    let body: { slug?: unknown; clientId?: unknown };
    try {
      body = await req.json();
    } catch {
      return noContent();
    }
    const slug = typeof body.slug === "string" ? body.slug.trim() : "";
    const rawClientId = typeof body.clientId === "string" ? body.clientId.trim() : "";
    if (!slug) return noContent();

    // 3. Resolve the property from the share token — only if sharing is enabled.
    //    This yields a trustworthy propertyId + companyId server-side.
    const property = await prisma.property.findFirst({
      where: { shareSlug: slug, shareEnabled: true },
      select: { id: true, companyId: true },
    });
    if (!property) return noContent();

    // 4. Validate any supplied clientId belongs to this listing's tenant. A
    //    forged/cross-tenant id is dropped to null rather than rejected.
    let clientId: string | null = null;
    let clientName: string | null = null;
    if (rawClientId) {
      const client = await prisma.client.findFirst({
        where: { id: rawClientId, companyId: property.companyId },
        select: { id: true, name: true },
      });
      if (client) {
        clientId = client.id;
        clientName = client.name;
      }
    }

    // 5. Persist the view (salted IP hash, sanitised UA).
    const ua = await userAgent();
    await prisma.propertyView.create({
      data: {
        companyId: property.companyId,
        propertyId: property.id,
        clientId,
        ipHash: hashIp(ip),
        userAgent: ua,
      },
    });

    // 6. Known client → refresh their active leads + maybe raise a high-intent
    //    alert. Anonymous views stop at step 5.
    if (clientId) {
      await handleKnownClientView(property.companyId, property.id, clientId, clientName);
    }

    return noContent();
  } catch (err) {
    // Telemetry is fire-and-forget: never error out the public page's beacon.
    console.error("[share/track] failed:", err);
    return noContent();
  }
}

/**
 * Side effects when a tracked view belongs to a known client:
 *   - bump the updatedAt of every active lead for that client so the lead score
 *     re-reads as "recent activity" (and any list re-sorts to the top),
 *   - when this is the view that reaches HIGH_INTENT_THRESHOLD on this listing,
 *     alert the assigned agent(s) of the client's active leads.
 */
async function handleKnownClientView(
  companyId: string,
  propertyId: string,
  clientId: string,
  clientName: string | null,
): Promise<void> {
  // Bump active leads' freshness so scoring recalculates on next read.
  await prisma.lead.updateMany({
    where: { companyId, clientId, stage: { notIn: ["CLOSED_WON", "CLOSED_LOST"] } },
    data: { updatedAt: new Date() },
  });

  // Count this client's views on THIS listing. Fire the alert only on the
  // threshold-crossing view to avoid repeat spam.
  const viewsOnListing = await prisma.propertyView.count({ where: { propertyId, clientId } });
  if (viewsOnListing !== HIGH_INTENT_THRESHOLD) return;

  // Notify the assigned agent of each active lead for this client.
  const activeLeads = await prisma.lead.findMany({
    where: {
      companyId,
      clientId,
      agentId: { not: null },
      stage: { notIn: ["CLOSED_WON", "CLOSED_LOST"] },
    },
    select: { id: true, agentId: true },
  });

  await Promise.all(
    activeLeads.map((lead) =>
      notify({
        companyId,
        userId: lead.agentId!,
        type: "GENERAL",
        title: `High intent — ${clientName ?? "a client"} keeps viewing a listing`,
        body: `${clientName ?? "This client"} has viewed the same property ${HIGH_INTENT_THRESHOLD}× — reach out now.`,
        link: `/leads/${lead.id}`,
      }),
    ),
  );
}
