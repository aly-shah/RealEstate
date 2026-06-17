"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyUser } from "@/lib/session";
import { startSession, logout } from "@/lib/wa-qr/manager";
import { logActivity } from "@/lib/activity";
import { setFlash } from "@/lib/flash";

/** OWNER-only — begin a QR-link session (the socket emits a QR the UI polls). */
export async function startWaQrLink(): Promise<void> {
  const user = await requireCompanyUser();
  if (user.role !== "OWNER") return;
  await startSession(user.companyId);
  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: "whatsapp.qr.link_started",
    entityType: "COMPANY",
    entityId: user.companyId,
    summary: "Started WhatsApp QR linking",
  });
}

/** OWNER-only — log out + drop the linked session. */
export async function unlinkWaQr(): Promise<void> {
  const user = await requireCompanyUser();
  if (user.role !== "OWNER") return;
  await logout(user.companyId);
  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: "whatsapp.qr.unlinked",
    entityType: "COMPANY",
    entityId: user.companyId,
    summary: "Unlinked WhatsApp (QR)",
  });
  await setFlash({ tone: "ok", message: "WhatsApp unlinked." });
  revalidatePath("/settings");
}
