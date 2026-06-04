import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { UPLOAD_ROOT, contentTypeFor } from "@/lib/uploads";

export const runtime = "nodejs";

/**
 * Public, token-scoped media proxy for shared property listings.
 *
 * Authorises purely by the share token: it serves a media file ONLY when that
 * media row belongs to a property whose public link is currently enabled. This
 * lets a client load the photos of the one property shared with them without a
 * session, while `/api/files` (CNICs, agreements, every other upload) stays
 * locked behind tenant-scoped auth.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string; mediaId: string }> },
) {
  const { slug, mediaId } = await params;

  const property = await prisma.property.findFirst({
    where: { shareSlug: slug, shareEnabled: true },
    select: { id: true, companyId: true },
  });
  if (!property) return new NextResponse("Not found", { status: 404 });

  const media = await prisma.propertyMedia.findFirst({
    where: { id: mediaId, propertyId: property.id },
    select: { url: true },
  });
  if (!media) return new NextResponse("Not found", { status: 404 });

  // External media (e.g. a CDN/stock URL) — just hand the client the source.
  if (/^https?:\/\//i.test(media.url)) {
    return NextResponse.redirect(media.url, 302);
  }

  // Internal upload — stored as `/api/files/<companyId>/<...rest>`. Resolve it
  // back to disk, confirming the file belongs to this property's tenant and
  // that the path can't escape the upload root.
  const m = media.url.match(/^\/api\/files\/([^/]+)\/(.+)$/);
  if (!m || m[1] !== property.companyId) return new NextResponse("Not found", { status: 404 });
  const rest = m[2];
  if (rest.includes("..")) return new NextResponse("Not found", { status: 404 });

  const companyRoot = path.join(UPLOAD_ROOT, property.companyId);
  const filePath = path.join(companyRoot, rest);
  if (!filePath.startsWith(companyRoot)) return new NextResponse("Not found", { status: 404 });

  try {
    const data = await readFile(filePath);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": contentTypeFor(path.extname(filePath)),
        // Public: anyone with the (unguessable) share link may cache it.
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
