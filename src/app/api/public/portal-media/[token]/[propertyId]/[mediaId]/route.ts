import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { UPLOAD_ROOT, contentTypeFor } from "@/lib/uploads";

export const runtime = "nodejs";

/**
 * Portal-scoped media proxy. Serves a property photo to a client's portal ONLY
 * when:
 *   - the portal token resolves to an enabled client, AND
 *   - the property is in that client's shortlist (linked to one of their leads
 *     or a visit), AND
 *   - the media belongs to that property.
 *
 * This lets the login-free portal show photos of the client's own shortlist
 * without enabling the per-property public share link, while every other upload
 * stays locked behind office auth.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string; propertyId: string; mediaId: string }> },
) {
  const { token, propertyId, mediaId } = await params;

  const client = await prisma.client.findFirst({
    where: { portalToken: token, portalEnabled: true },
    select: { id: true, companyId: true },
  });
  if (!client) return new NextResponse("Not found", { status: 404 });

  // Property must be in this client's shortlist (a lead or a visit links it).
  const [leadLink, showingLink] = await Promise.all([
    prisma.lead.findFirst({ where: { companyId: client.companyId, clientId: client.id, propertyId }, select: { id: true } }),
    prisma.showing.findFirst({ where: { companyId: client.companyId, clientId: client.id, propertyId }, select: { id: true } }),
  ]);
  if (!leadLink && !showingLink) return new NextResponse("Not found", { status: 404 });

  const media = await prisma.propertyMedia.findFirst({
    where: { id: mediaId, propertyId },
    select: { url: true },
  });
  if (!media) return new NextResponse("Not found", { status: 404 });

  // External media (CDN/stock URL) — hand the client the source.
  if (/^https?:\/\//i.test(media.url)) {
    return NextResponse.redirect(media.url, 302);
  }

  // Internal upload — `/api/files/<companyId>/<...rest>`. Resolve to disk,
  // confirming tenant ownership and that the path can't escape the root.
  const m = media.url.match(/^\/api\/files\/([^/]+)\/(.+)$/);
  if (!m || m[1] !== client.companyId) return new NextResponse("Not found", { status: 404 });
  const rest = m[2];
  if (rest.includes("..")) return new NextResponse("Not found", { status: 404 });

  const companyRoot = path.join(UPLOAD_ROOT, client.companyId);
  const filePath = path.join(companyRoot, rest);
  if (!filePath.startsWith(companyRoot)) return new NextResponse("Not found", { status: 404 });

  try {
    const data = await readFile(filePath);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": contentTypeFor(path.extname(filePath)),
        // Private to the (unguessable) token holder.
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
