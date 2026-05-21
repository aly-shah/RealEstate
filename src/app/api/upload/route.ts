import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { auth } from "@/auth";
import { UPLOAD_ROOT, MAX_UPLOAD_BYTES, ALLOWED_EXT, safeName } from "@/lib/uploads";

export const runtime = "nodejs";

/** POST multipart/form-data with field "file" → stores it tenant-scoped. */
export async function POST(req: NextRequest) {
  const session = await auth();
  const user = session?.user;
  if (!user?.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "File exceeds 10 MB" }, { status: 413 });

  const original = safeName(file.name);
  const ext = path.extname(original).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) return NextResponse.json({ error: `File type ${ext || "?"} not allowed` }, { status: 415 });

  const dir = path.join(UPLOAD_ROOT, user.companyId);
  await mkdir(dir, { recursive: true });
  const stored = `${randomUUID()}${ext}`;
  await writeFile(path.join(dir, stored), Buffer.from(await file.arrayBuffer()));

  return NextResponse.json({
    url: `/api/files/${user.companyId}/${stored}`,
    name: original,
  });
}
