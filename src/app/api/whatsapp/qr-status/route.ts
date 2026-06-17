import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { requireCompanyUser } from "@/lib/session";
import { getStatus } from "@/lib/wa-qr/manager";

export const runtime = "nodejs";

/**
 * Poll endpoint for the QR-link Settings panel. Returns the current session
 * status and, while PENDING, the QR rendered as a data-URL image to scan.
 * OWNER-only + tenant-scoped (resolves the company from the session).
 */
export async function GET() {
  const user = await requireCompanyUser();
  if (user.role !== "OWNER") return NextResponse.json({ error: "Not allowed" }, { status: 403 });

  const { status, qr } = await getStatus(user.companyId);
  const qrImage = qr ? await QRCode.toDataURL(qr, { margin: 1, width: 248 }) : null;
  return NextResponse.json({ status, qr: qrImage });
}
