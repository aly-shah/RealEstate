"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyUser } from "@/lib/session";
import { startSession, logout } from "@/lib/wa-qr/manager";
import { sendCompanyText } from "@/lib/wa-send";
import { logActivity } from "@/lib/activity";
import { setFlash } from "@/lib/flash";

export interface TestSendResult {
  ok: boolean;
  error?: string;
}

/** OWNER-only — fire a one-off test message through the linked session. */
export async function sendWaQrTest(toPhone: string): Promise<TestSendResult> {
  const user = await requireCompanyUser();
  if (user.role !== "OWNER") return { ok: false, error: "Not allowed." };
  const phone = String(toPhone).replace(/[^\d+]/g, "");
  if (phone.replace(/\D/g, "").length < 8) {
    return { ok: false, error: "Enter a valid number with country code (e.g. 923001234567)." };
  }
  const res = await sendCompanyText(
    user.companyId,
    phone,
    "✅ Test message from Proptimizr — your WhatsApp is linked and ready.",
  );
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

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
