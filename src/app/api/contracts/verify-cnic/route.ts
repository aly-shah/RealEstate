import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { processCnicOcr } from "@/lib/ocr";
import { UPLOAD_ROOT, MAX_UPLOAD_BYTES } from "@/lib/uploads";
import { mimeMatchesExtension } from "@/lib/uploads/mime";
import { clientIp } from "@/lib/request-meta";
import { rateLimit, formatRetryAfter } from "@/lib/rate-limit";
import type { ContractStatus, Prisma } from "@prisma/client";

export const runtime = "nodejs";

// Public endpoint (token-scoped), so it's defensive: image-only, size-capped,
// magic-byte-sniffed, rate-limited per IP. CNICs come from phone cameras.
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);
const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/avif": ".avif",
};
const MIN_OCR_CONFIDENCE = 0.8;

/**
 * POST /api/contracts/verify-cnic  (multipart: token, cnicImage)
 *
 * The remote receiver for the public verify link. Resolves the party from the
 * unguessable token, OCRs the uploaded CNIC, persists the image into the
 * tenant's Document store, records the extracted identity on the Contract, and
 * advances the contract state — flipping to PENDING_VERIFICATION only once BOTH
 * parties are recorded.
 *
 * NOTE on the proxy: this path sits under the auth gate's matcher exclusion
 * (see src/proxy.ts) so an anonymous client isn't bounced to /login.
 */
export async function POST(req: Request) {
  try {
    // 1. Rate-limit per IP — cheap abuse protection on an unauthenticated route.
    const ip = await clientIp();
    const limited = rateLimit({ key: `cnic-verify:ip:${ip}`, limit: 10, windowMs: 60_000 });
    if (!limited.allowed) {
      return NextResponse.json(
        { error: `Too many attempts. Try again in ${formatRetryAfter(limited.retryAfterMs)}.` },
        { status: 429 },
      );
    }

    // 2. Parse the multipart body.
    const formData = await req.formData();
    const token = String(formData.get("token") ?? "");
    const file = formData.get("cnicImage");
    if (!token || !(file instanceof File)) {
      return NextResponse.json({ error: "Missing required parameters" }, { status: 400 });
    }
    if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "Image is empty or exceeds 10 MB." }, { status: 413 });
    }

    // 3. Resolve the party from the token.
    const contract = await prisma.contract.findFirst({
      where: { OR: [{ landlordToken: token }, { renterToken: token }] },
    });
    if (!contract) {
      return NextResponse.json({ error: "Invalid link signature" }, { status: 404 });
    }
    // Don't let a finalised contract be re-opened by a stale link.
    if (["ACTIVE", "EXPIRED", "TERMINATED"].includes(contract.status)) {
      return NextResponse.json({ error: "This contract is already finalised." }, { status: 409 });
    }
    const isLandlord = contract.landlordToken === token;

    // 4. Validate the image bytes (extension + magic-byte sniff).
    const buffer = Buffer.from(await file.arrayBuffer());
    let ext = path.extname(file.name || "").toLowerCase();
    if (!IMAGE_EXT.has(ext)) ext = MIME_TO_EXT[file.type] ?? "";
    if (!IMAGE_EXT.has(ext)) {
      return NextResponse.json({ error: "Please upload a JPG, PNG or WebP image." }, { status: 415 });
    }
    const sniff = mimeMatchesExtension(ext, buffer.subarray(0, 32));
    if (!sniff.ok) {
      return NextResponse.json({ error: "That file doesn't look like a valid image." }, { status: 415 });
    }

    // 5. OCR. Gate on confidence before we record anything.
    const ocrData = await processCnicOcr(buffer);
    if (ocrData.confidence < MIN_OCR_CONFIDENCE) {
      return NextResponse.json(
        { error: "OCR processing failed. Image clarity low — retake in good light." },
        { status: 422 },
      );
    }

    // 6. Persist the CNIC image into the tenant's upload store. It's served via
    //    /api/files, which stays behind office auth — only staff can view it.
    const dir = path.join(UPLOAD_ROOT, contract.companyId);
    await mkdir(dir, { recursive: true });
    const stored = `${randomUUID()}${ext}`;
    await writeFile(path.join(dir, stored), buffer);
    const fileUrl = `/api/files/${contract.companyId}/${stored}`;

    // 7. Compute the next status. The contract advances to PENDING_VERIFICATION
    //    only when BOTH parties are recorded; otherwise it waits on the other.
    const otherVerified = isLandlord ? !!contract.renterVerifiedAt : !!contract.landlordVerifiedAt;
    const nextStatus: ContractStatus = otherVerified
      ? "PENDING_VERIFICATION"
      : isLandlord
        ? "AWAITING_CNIC_RENTER"
        : "AWAITING_CNIC_LANDLORD";

    const now = new Date();
    const contractData: Prisma.ContractUpdateInput = isLandlord
      ? {
          landlordCnic: ocrData.cnicNumber,
          landlordCnicName: ocrData.fullName,
          landlordVerifiedAt: now,
          status: nextStatus,
        }
      : {
          renterCnic: ocrData.cnicNumber,
          renterCnicName: ocrData.fullName,
          renterVerifiedAt: now,
          status: nextStatus,
        };

    // 8. Only the renter is guaranteed to be a real Client — resolve a valid id
    //    so the Document FK can never point at a stale/foreign client.
    let renterClientId: string | null = null;
    if (!isLandlord && contract.renterId) {
      const c = await prisma.client.findFirst({
        where: { id: contract.renterId, companyId: contract.companyId },
        select: { id: true },
      });
      renterClientId = c?.id ?? null;
    }

    // 9. Update the contract + attach the Document atomically. The Document
    //    links by dealId (always valid) and only carries clientId for the renter.
    await prisma.$transaction([
      prisma.contract.update({ where: { id: contract.id }, data: contractData }),
      prisma.document.create({
        data: {
          companyId: contract.companyId,
          type: "CNIC_PASSPORT",
          name: `${isLandlord ? "Landlord" : "Renter"} CNIC — ${ocrData.fullName}`,
          url: fileUrl,
          verification: "VERIFIED",
          dealId: contract.dealId,
          clientId: renterClientId,
        },
      }),
    ]);

    return NextResponse.json({
      success: true,
      extractedName: ocrData.fullName,
      extractedCnic: ocrData.cnicNumber,
    });
  } catch (error) {
    console.error("[contracts/verify-cnic] failed:", error);
    return NextResponse.json({ error: "Internal processing error" }, { status: 500 });
  }
}
