import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { UPLOAD_ROOT, contentTypeFor } from "@/lib/uploads";

export const runtime = "nodejs";

/**
 * Portal-scoped document proxy. Serves a document to a client's portal ONLY when:
 *   - the portal token resolves to an enabled client, AND
 *   - the document is linked to that client (clientId) within the same tenant.
 *
 * Mirrors the portal-media proxy: external URLs redirect through; internal
 * `/api/files/<companyId>/...` uploads are read from disk with tenant + path
 * containment checks. Everything else (placeholder/generated docs) 404s — the
 * portal only links here for servable documents.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string; docId: string }> },
) {
  const { token, docId } = await params;

  const client = await prisma.client.findFirst({
    where: { portalToken: token, portalEnabled: true },
    select: { id: true, companyId: true },
  });
  if (!client) return new NextResponse("Not found", { status: 404 });

  const doc = await prisma.document.findFirst({
    where: { id: docId, companyId: client.companyId, clientId: client.id },
    select: { url: true },
  });
  if (!doc) return new NextResponse("Not found", { status: 404 });

  // External document (CDN/external link) — hand the client the source.
  if (/^https?:\/\//i.test(doc.url)) {
    return NextResponse.redirect(doc.url, 302);
  }

  // Internal upload — `/api/files/<companyId>/<...rest>`. Resolve to disk,
  // confirming tenant ownership and that the path can't escape the root.
  const m = doc.url.match(/^\/api\/files\/([^/]+)\/(.+)$/);
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
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
