import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { auth } from "@/auth";
import { UPLOAD_ROOT, contentTypeFor } from "@/lib/uploads";
import { isUserActive } from "@/lib/user-status";

export const runtime = "nodejs";

/**
 * Serves a stored upload. Enforces tenant isolation: the first path segment is
 * the owning companyId and must match the caller's company.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const session = await auth();
  const user = session?.user;
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  // Suspension re-check (same reasoning as /api/upload).
  if (!(await isUserActive(user.id, user.role))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const segments = (await params).path;
  const [companyId, ...rest] = segments;

  // Block traversal and cross-tenant access.
  if (!companyId || rest.length === 0 || segments.some((s) => s.includes("..") || s.includes("/"))) {
    return new NextResponse("Not found", { status: 404 });
  }
  const isSuper = user.role === "SUPER_ADMIN";
  if (!isSuper && companyId !== user.companyId) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const filePath = path.join(UPLOAD_ROOT, companyId, ...rest);
  if (!filePath.startsWith(path.join(UPLOAD_ROOT, companyId))) {
    return new NextResponse("Not found", { status: 404 });
  }

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
