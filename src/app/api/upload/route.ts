import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { auth } from "@/auth";
import { UPLOAD_ROOT, MAX_UPLOAD_BYTES, ALLOWED_EXT, safeName } from "@/lib/uploads";
import { mimeMatchesExtension } from "@/lib/uploads/mime";
import { scanForViruses } from "@/lib/uploads/scan";
import { rateLimit, formatRetryAfter } from "@/lib/rate-limit";
import { isUserActive } from "@/lib/user-status";

export const runtime = "nodejs";

/**
 * Per-user upload budget. Generous enough for an agent batch-uploading
 * property photos (~30 per minute); strict enough that a compromised account
 * can't fill the disk in seconds.
 */
const UPLOAD_LIMIT = 30;
const UPLOAD_WINDOW_MS = 60 * 1000;

/** POST multipart/form-data with field "file" → stores it tenant-scoped. */
export async function POST(req: NextRequest) {
  const session = await auth();
  const user = session?.user;
  if (!user?.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // 0. Suspension re-check — the JWT may outlive a suspension event by up to
  // the cache TTL (60s). Without this, a suspended user with a fresh token
  // could still POST uploads through this raw route handler.
  if (!(await isUserActive(user.id, user.role))) {
    return NextResponse.json({ error: "Account suspended." }, { status: 403 });
  }

  // 1. Per-user rate limit (covers both well-behaved bursts and abuse).
  const limited = rateLimit({
    key: `upload:user:${user.id}`,
    limit: UPLOAD_LIMIT,
    windowMs: UPLOAD_WINDOW_MS,
  });
  if (!limited.allowed) {
    return NextResponse.json(
      { error: `Too many uploads. Try again in ${formatRetryAfter(limited.retryAfterMs)}.` },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limited.retryAfterMs / 1000)) } },
    );
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "File exceeds 10 MB" }, { status: 413 });

  const original = safeName(file.name);
  const ext = path.extname(original).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) return NextResponse.json({ error: `File type ${ext || "?"} not allowed` }, { status: 415 });

  // 2. Read the bytes once; reuse for MIME sniff, virus scan, and disk write.
  const buf = Buffer.from(await file.arrayBuffer());

  // 3. Magic-byte check — catches a `.pdf` filename containing other content.
  const sniff = mimeMatchesExtension(ext, buf.subarray(0, 32));
  if (!sniff.ok) {
    return NextResponse.json({ error: sniff.reason }, { status: 415 });
  }

  // 4. Virus scan (no-op today; see lib/uploads/scan.ts for swap instructions).
  const scan = await scanForViruses(buf);
  if (!scan.clean) {
    return NextResponse.json(
      { error: `Upload rejected by virus scan${scan.reason ? `: ${scan.reason}` : ""}.` },
      { status: 422 },
    );
  }

  const dir = path.join(UPLOAD_ROOT, user.companyId);
  await mkdir(dir, { recursive: true });
  const stored = `${randomUUID()}${ext}`;
  await writeFile(path.join(dir, stored), buf);

  return NextResponse.json({
    url: `/api/files/${user.companyId}/${stored}`,
    name: original,
  });
}
