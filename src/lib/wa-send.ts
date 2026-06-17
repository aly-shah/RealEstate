import "server-only";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { sendWhatsAppText, sendWhatsAppTemplate, type SendResult } from "@/lib/wa-business";
import { isConnected, sendText as sendViaQr } from "@/lib/wa-qr/manager";

/**
 * Company-level WhatsApp send. Prefers a live QR-linked session (Baileys) when
 * one is connected, otherwise falls back to the official Cloud API. Templates are
 * rendered to plain text for the QR path (Baileys has no Meta "template" concept,
 * and a linked account isn't bound by the 24h customer-service window).
 */

function qrOk(): SendResult {
  return { ok: true, messageId: `wa-qr:${Date.now()}` };
}
const notConnected: SendResult = {
  ok: false,
  status: 0,
  error: "WhatsApp not connected (no QR session and no Cloud API credentials).",
};

async function cloudCreds(companyId: string): Promise<{ phoneNumberId: string; accessToken: string } | null> {
  const c = await prisma.company.findUnique({
    where: { id: companyId },
    select: { whatsappPhoneId: true, whatsappAccessToken: true },
  });
  const token = decryptSecret(c?.whatsappAccessToken);
  return c?.whatsappPhoneId && token ? { phoneNumberId: c.whatsappPhoneId, accessToken: token } : null;
}

/** Render a stored template's body with positional params, for QR (text) delivery. */
async function renderTemplateText(
  companyId: string,
  name: string,
  language: string,
  bodyParams: string[],
): Promise<string | null> {
  const tpl = await prisma.whatsAppTemplate.findFirst({
    where: { companyId, name, language },
    select: { bodyText: true, headerText: true },
  });
  if (!tpl) return null;
  let body = tpl.bodyText;
  bodyParams.forEach((v, i) => {
    body = body.split(`{{${i + 1}}}`).join(v ?? "");
  });
  return (tpl.headerText ? `${tpl.headerText}\n\n` : "") + body;
}

/** Can the company send WhatsApp at all — a live QR session OR Cloud API creds. */
export async function whatsAppAvailable(companyId: string): Promise<boolean> {
  if (isConnected(companyId)) return true;
  return !!(await cloudCreds(companyId));
}

/** Send free text — QR socket first, Cloud API fallback. */
export async function sendCompanyText(companyId: string, toPhone: string, body: string): Promise<SendResult> {
  if (isConnected(companyId)) {
    try {
      if (await sendViaQr(companyId, toPhone, body)) return qrOk();
    } catch {
      /* fall through to Cloud API */
    }
  }
  const creds = await cloudCreds(companyId);
  if (!creds) return notConnected;
  return sendWhatsAppText({ ...creds, toPhone, body });
}

/** Send a template — QR renders it to text, otherwise the Cloud API template send. */
export async function sendCompanyTemplate(
  companyId: string,
  toPhone: string,
  templateName: string,
  language: string,
  bodyParams: string[],
  headerParams: string[] = [],
): Promise<SendResult> {
  if (isConnected(companyId)) {
    const text = await renderTemplateText(companyId, templateName, language, bodyParams);
    if (text) {
      try {
        if (await sendViaQr(companyId, toPhone, text)) return qrOk();
      } catch {
        /* fall through to Cloud API */
      }
    }
  }
  const creds = await cloudCreds(companyId);
  if (!creds) return notConnected;
  return sendWhatsAppTemplate({ ...creds, toPhone, templateName, language, bodyParams, headerParams });
}
