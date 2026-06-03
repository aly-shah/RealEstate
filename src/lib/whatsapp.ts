/**
 * WhatsApp deep-link plumbing.
 *
 * Phase 5 stays on `wa.me/<phone>?text=<urlencoded>` — no Business API
 * integration, no outbound delivery, no opt-in tracking. The point is just
 * "open a chat with this client and pre-fill the right message". Owners
 * who later want real two-way WhatsApp can swap this layer; the templates
 * carry over unchanged.
 *
 * Country code default is 92 (Pakistan) since the product targets PK.
 */

import { fmtDate, money } from "@/lib/format";

const PK_COUNTRY_CODE = "92";

/**
 * Convert messy phone input (any of "+92 300 1234567", "0300-1234567",
 * "3001234567", "92 300 1234567") into the digits-only E.164 form that
 * wa.me requires. Returns null when there isn't enough to dial.
 *
 * Rules:
 *   - strip everything that isn't a digit
 *   - drop a single leading "0" (Pakistan local format)
 *   - if the result doesn't already start with the country code, prepend it
 *   - reject runs shorter than 9 digits (no PK mobile is that short)
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;

  if (digits.startsWith("00")) digits = digits.slice(2); // 00-prefix international form
  if (digits.startsWith("0")) digits = digits.slice(1);

  if (!digits.startsWith(PK_COUNTRY_CODE)) {
    // 10-digit local mobile (3001234567) needs the country code prepended.
    if (digits.length >= 9 && digits.length <= 11) {
      digits = PK_COUNTRY_CODE + digits;
    }
  }

  if (digits.length < 11) return null; // shorter than 92 + 9 digits → not dialable
  return digits;
}

/** wa.me deep link. Returns null when the phone can't be normalised. */
export function waMeLink(phone: string | null | undefined, message: string): string | null {
  const p = normalizePhone(phone);
  if (!p) return null;
  return `https://wa.me/${p}?text=${encodeURIComponent(message)}`;
}

// ─────────────────────────────────────────────────────────── Templates ────

/**
 * Each template is a pure function from a typed context to message text.
 * Tone: opens with "Salaam" (universal PK greeting), names the sender and
 * the firm so the recipient knows it's not spam, ends with a clear CTA.
 *
 * Keep lines short — WhatsApp wraps oddly on long paragraphs.
 */

interface WaCommonCtx {
  clientName: string | null | undefined;
  agentName: string | null | undefined;
  companyName: string;
  /**
   * Optional per-tenant signature override (Company.whatsappSignature). When
   * set, replaces the default "{agent} — {company}" closer. Useful for
   * companies that want a tagline, URL or compliance note on every message.
   */
  signature?: string | null;
}

const open = (clientName: string | null | undefined) =>
  `Assalam-o-Alaikum ${clientName?.trim() || "there"},`;

const sign = (
  agentName: string | null | undefined,
  companyName: string,
  signature?: string | null,
) => {
  if (signature?.trim()) return `\n\nRegards,\n${signature.trim()}`;
  return `\n\nRegards,\n${agentName?.trim() ? `${agentName.trim()} — ${companyName}` : companyName}`;
};

export const TEMPLATES = {
  newLeadFollowUp: (ctx: WaCommonCtx & { source?: string }) =>
    `${open(ctx.clientName)}\n\nThis is ${ctx.agentName ?? "the team"} from ${ctx.companyName}. ` +
    `${ctx.source ? `Thanks for reaching out via ${ctx.source.toLowerCase().replace(/_/g, " ")}. ` : ""}` +
    `When would be a good time for a quick chat about the property requirement you shared?${sign(ctx.agentName, ctx.companyName, ctx.signature)}`,

  propertyDetails: (ctx: WaCommonCtx & {
    property: { reference: string; title: string; salePrice?: number; monthlyRent?: number; area?: string | null };
    propertyUrl?: string;
  }) => {
    const lines: string[] = [
      open(ctx.clientName),
      "",
      `Sharing the property you asked about:`,
      `• ${ctx.property.title}`,
      `• Ref: ${ctx.property.reference}`,
    ];
    if (ctx.property.area) lines.push(`• Location: ${ctx.property.area}`);
    if (ctx.property.salePrice) lines.push(`• Asking: ${money(ctx.property.salePrice)}`);
    if (ctx.property.monthlyRent) lines.push(`• Rent: ${money(ctx.property.monthlyRent)}/month`);
    if (ctx.propertyUrl) lines.push("", `Listing: ${ctx.propertyUrl}`);
    lines.push("", "Would you like to schedule a viewing?");
    return lines.join("\n") + sign(ctx.agentName, ctx.companyName);
  },

  siteVisitConfirmation: (ctx: WaCommonCtx & {
    when: Date | string;
    property: { title: string; reference: string; area?: string | null };
  }) =>
    `${open(ctx.clientName)}\n\nConfirming our visit on ${fmtDate(ctx.when)}:\n` +
    `• ${ctx.property.title} (${ctx.property.reference})` +
    `${ctx.property.area ? `\n• ${ctx.property.area}` : ""}\n\n` +
    `Please share your location 15 minutes before so I can meet you on site.${sign(ctx.agentName, ctx.companyName, ctx.signature)}`,

  paymentReminder: (ctx: WaCommonCtx & {
    amount: number;
    dueDate: Date | string;
    dealRef: string;
    overdue?: boolean;
  }) =>
    `${open(ctx.clientName)}\n\nA gentle reminder that the payment of ${money(ctx.amount)} ` +
    `for deal ${ctx.dealRef} is ${ctx.overdue ? "**overdue**" : "due"} on ${fmtDate(ctx.dueDate)}. ` +
    `Please let me know if you'd like the receipt details or any help with the transfer.${sign(ctx.agentName, ctx.companyName, ctx.signature)}`,

  dealUpdate: (ctx: WaCommonCtx & { dealRef: string; stage: string }) =>
    `${open(ctx.clientName)}\n\nQuick update on deal ${ctx.dealRef}: we're now at the ` +
    `**${ctx.stage.replace(/_/g, " ").toLowerCase()}** stage. ` +
    `Let me know if you'd like a call to walk through the next step.${sign(ctx.agentName, ctx.companyName, ctx.signature)}`,

  documentRequest: (ctx: WaCommonCtx & { docType: string; dealRef?: string }) =>
    `${open(ctx.clientName)}\n\nTo move things forward${ctx.dealRef ? ` on deal ${ctx.dealRef}` : ""}, ` +
    `could you please share a copy of your **${ctx.docType.replace(/_/g, " ").toLowerCase()}**? ` +
    `A clear photo or PDF is fine.${sign(ctx.agentName, ctx.companyName, ctx.signature)}`,
} as const;

export type TemplateKey = keyof typeof TEMPLATES;
