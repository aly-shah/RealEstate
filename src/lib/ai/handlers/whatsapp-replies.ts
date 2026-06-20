import { runAi } from "@/lib/ai/run";
import { tolerantJsonParse } from "@/lib/ai/handlers/whatsapp-classify";

/**
 * Copilot suggested replies — three ready-to-send reply options for a WhatsApp
 * conversation: polished English, friendly English, and Roman Urdu. The agent
 * edits before sending; nothing is auto-sent. Cached via runAi against the
 * conversation thread (the hash invalidates when new messages arrive).
 */

export interface SuggestedReplies {
  professional: string;
  friendly: string;
  romanUrdu: string;
}

export type RepliesResult =
  | { ok: true; replies: SuggestedReplies; fromCache: boolean }
  | { ok: false; reason: string };

const SYSTEM = `You draft WhatsApp replies for a Pakistani real-estate agent (Proptimizr).
Given the client's recent messages, write THREE reply options.

Respond with a SINGLE JSON object — no prose, no Markdown, no code fences. Keys EXACTLY:
  professional: a polished, professional English reply
  friendly: a warm, casual English reply
  roman_urdu: a natural Roman-Urdu reply (Urdu written in Latin script), as a Pakistani agent would actually type

Each reply <= 320 chars, ready to send, no bracket placeholders. Be helpful and move the conversation forward (offer to share matching options, schedule a visit, answer their question). Use ONLY what's in the conversation — never invent prices, areas, or names. Currency is PKR.`;

export async function suggestWhatsAppReplies(input: {
  companyId: string;
  phone: string;
  thread: string;
}): Promise<RepliesResult> {
  if (!input.thread.trim()) return { ok: false, reason: "No recent messages to reply to." };

  const res = await runAi({
    companyId: input.companyId,
    type: "LEAD_REPLY_DRAFT",
    entity: { type: "WHATSAPP_CONVO", id: input.phone },
    system: SYSTEM,
    prompt: "Draft the three reply options for this conversation.",
    inputs: { conversation: input.thread.slice(0, 1500) },
    maxTokens: 600,
    cacheTtlMs: 10 * 60_000,
  });
  if (!res.ok) return { ok: false, reason: res.reason };

  const o = tolerantJsonParse(res.content) as Record<string, unknown> | null;
  if (!o) return { ok: false, reason: "AI returned an unreadable response — try again." };
  const s = (v: unknown) => (typeof v === "string" ? v.slice(0, 600) : "");
  const replies: SuggestedReplies = {
    professional: s(o.professional),
    friendly: s(o.friendly),
    romanUrdu: s(o.roman_urdu),
  };
  if (!replies.professional && !replies.friendly && !replies.romanUrdu) {
    return { ok: false, reason: "AI returned no replies — try again." };
  }
  return { ok: true, replies, fromCache: res.fromCache };
}
