import { normalizePhone } from "@/lib/whatsapp";

/**
 * Thin wrapper around the Meta WhatsApp Cloud API for OUTBOUND text
 * messages. No SDK dependency — `fetch` against graph.facebook.com is
 * stable and the surface area we use is tiny.
 *
 * Free-form text messages are only allowed inside the 24-hour customer
 * service window (i.e. when the user has messaged us in the last 24h).
 * Outside that window Meta requires pre-approved templates — Phase 9.5
 * ships free-form only, and surfaces Meta's error verbatim when the
 * window is closed so the operator knows to switch channels. Template
 * support is a follow-up that only changes the request body.
 */

const GRAPH_VERSION = "v21.0";

export interface SendTextInput {
  /** Meta's phone_number_id for the sending business line. */
  phoneNumberId: string;
  /** Long-lived access token for this business line. */
  accessToken: string;
  /** Recipient phone (normalised to E.164 — leading "+" added). */
  toPhone: string;
  /** UTF-8 body — Meta caps at 4,096 chars; we cap at 1,000 to stay sane. */
  body: string;
}

export type SendResult =
  | { ok: true; messageId: string }
  | { ok: false; status: number; error: string };

/** Back-compat alias — older imports use SendTextResult. */
export type SendTextResult = SendResult;

/**
 * Send a free-form text message via the Meta Cloud API. Returns the
 * Meta-assigned `wamid` on success, or a structured failure with the
 * upstream HTTP status + error string. Never throws — callers
 * (the job handler) decide whether to retry.
 */
export async function sendWhatsAppText(input: SendTextInput): Promise<SendResult> {
  const to = normalizePhone(input.toPhone);
  if (!to) return { ok: false, status: 400, error: "Recipient phone is invalid." };

  return postMessage(input.phoneNumberId, input.accessToken, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { preview_url: false, body: input.body.slice(0, 1_000) },
  });
}

export interface SendTemplateInput {
  phoneNumberId: string;
  accessToken: string;
  toPhone: string;
  /** Pre-approved template name from Meta Business Manager. */
  templateName: string;
  /** Language code per Meta's catalog — e.g. "en", "en_US", "ur". */
  language: string;
  /**
   * Positional body parameters. Meta substitutes them into the template's
   * `{{1}}`, `{{2}}`, ... placeholders in order. Pass an empty array for
   * templates with no body variables.
   */
  bodyParams: string[];
  /**
   * Positional header parameters (TEXT-format headers only). Pass an
   * empty array for templates with no header or no header variables.
   * MEDIA headers (image/video/document) aren't supported here — those
   * are filtered out of the catalog UI.
   */
  headerParams?: string[];
}

/**
 * Send a pre-approved template message — required for outbound to
 * recipients outside Meta's 24-hour customer-service window. The
 * template must already be approved in Meta Business Manager under
 * the same WABA as the sending phone number; this call just supplies
 * the name + parameters.
 */
export async function sendWhatsAppTemplate(input: SendTemplateInput): Promise<SendResult> {
  const to = normalizePhone(input.toPhone);
  if (!to) return { ok: false, status: 400, error: "Recipient phone is invalid." };

  const components: Array<{
    type: string;
    parameters: Array<{ type: string; text: string }>;
  }> = [];
  if (input.headerParams && input.headerParams.length > 0) {
    components.push({
      type: "header",
      parameters: input.headerParams.map((p) => ({
        type: "text",
        text: String(p).slice(0, 1_000),
      })),
    });
  }
  if (input.bodyParams.length > 0) {
    components.push({
      type: "body",
      parameters: input.bodyParams.map((p) => ({
        type: "text",
        text: String(p).slice(0, 1_000),
      })),
    });
  }

  return postMessage(input.phoneNumberId, input.accessToken, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name: input.templateName,
      language: { code: input.language },
      components,
    },
  });
}

export interface TemplateDef {
  name: string;
  language: string;
  category: string;
  status: string;
  bodyText: string;
  paramCount: number;
  /**
   * Text-header body (when the template has a TEXT-format header).
   * Empty string for templates with no header or with a MEDIA header
   * (image/video/document) — the send UI doesn't yet support media
   * headers, so the operator sees a "media header — not yet supported"
   * hint and the template is still listed but not selectable.
   */
  headerText: string;
  headerParamCount: number;
  /** True when the template has a non-TEXT header (the kind we skip). */
  hasMediaHeader: boolean;
}

/**
 * Fetch the tenant's WhatsApp message-template catalog from Meta.
 * One page is usually enough (Meta's default is ~25); we follow
 * pagination cursors to a hard cap so a runaway response can't
 * memory-bomb the server.
 *
 * Returns the parsed entries on success or an error envelope on any
 * upstream failure. Templates without a body component (e.g. media-only)
 * are skipped — the send UI only supports body parameters.
 */
export async function fetchTemplateCatalog(input: {
  wabaId: string;
  accessToken: string;
}): Promise<{ ok: true; templates: TemplateDef[] } | { ok: false; status: number; error: string }> {
  const out: TemplateDef[] = [];
  let url:
    | string
    | undefined = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(input.wabaId)}/message_templates?fields=name,language,category,status,components&limit=100`;
  let pages = 0;
  const MAX_PAGES = 10; // hard cap: 1,000 templates

  while (url && pages < MAX_PAGES) {
    pages += 1;
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${input.accessToken}` },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Network failure";
      return { ok: false, status: 0, error: msg };
    }
    if (!resp.ok) {
      let errText = `HTTP ${resp.status}`;
      try {
        const j = (await resp.json()) as { error?: { message?: string } };
        if (j.error?.message) errText = `${errText}: ${j.error.message}`;
      } catch {
        /* keep status */
      }
      return { ok: false, status: resp.status, error: errText.slice(0, 500) };
    }
    let body: {
      data?: Array<{
        name?: string;
        language?: string;
        category?: string;
        status?: string;
        components?: Array<{ type?: string; text?: string; format?: string }>;
      }>;
      paging?: { next?: string };
    };
    try {
      body = (await resp.json()) as typeof body;
    } catch {
      return { ok: false, status: 502, error: "Meta returned an unparseable body." };
    }
    for (const t of body.data ?? []) {
      if (!t.name || !t.language || !t.status) continue;
      const comps = t.components ?? [];
      const bodyComp = comps.find(
        (c) => typeof c.type === "string" && c.type.toUpperCase() === "BODY" && typeof c.text === "string",
      );
      const bodyText = bodyComp?.text ?? "";
      // Skip templates without a body component — the send UI only
      // supports body-parameter substitution.
      if (!bodyText) continue;
      // Header component is optional. Meta's `format` field tells us
      // whether it's TEXT (we can handle) or IMAGE/VIDEO/DOCUMENT
      // (we can't yet; surface as a hint).
      const headerComp = comps.find(
        (c) => typeof c.type === "string" && c.type.toUpperCase() === "HEADER",
      );
      const headerFormat = headerComp?.format?.toUpperCase() ?? null;
      const isTextHeader = headerFormat === "TEXT" && typeof headerComp?.text === "string";
      const headerText = isTextHeader ? (headerComp!.text ?? "") : "";
      out.push({
        name: t.name,
        language: t.language,
        category: typeof t.category === "string" ? t.category : "UNKNOWN",
        status: t.status,
        bodyText: bodyText.slice(0, 2_000),
        paramCount: highestPlaceholder(bodyText),
        headerText: headerText.slice(0, 500),
        headerParamCount: isTextHeader ? highestPlaceholder(headerText) : 0,
        hasMediaHeader: !!headerComp && !isTextHeader,
      });
    }
    url = body.paging?.next;
  }
  return { ok: true, templates: out };
}

/** Highest N in any `{{N}}` placeholder, 0 if none. */
function highestPlaceholder(s: string): number {
  let max = 0;
  for (const m of s.matchAll(/\{\{(\d+)\}\}/g)) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

/**
 * GET /<phone_number_id> with the bearer token — Meta returns the
 * phone number's metadata on a valid token, 401 on an expired/revoked
 * one. Cheapest call we can make to validate credentials without
 * touching the message-send rate limits or notifying a recipient.
 *
 * Returns:
 *   { ok: true } when the token is valid
 *   { ok: false, status, error } on any failure (network, 401, 403)
 */
export async function pingWhatsAppToken(input: {
  phoneNumberId: string;
  accessToken: string;
}): Promise<SendResult | { ok: true }> {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(input.phoneNumberId)}`;
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${input.accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Network failure";
    return { ok: false, status: 0, error: msg };
  }
  if (resp.ok) return { ok: true };
  let errText = `HTTP ${resp.status}`;
  try {
    const j = (await resp.json()) as { error?: { message?: string } };
    if (j.error?.message) errText = `${errText}: ${j.error.message}`;
  } catch {
    /* keep bare status */
  }
  return { ok: false, status: resp.status, error: errText.slice(0, 500) };
}

/**
 * Shared POST helper — every send variant funnels through here so timeout,
 * error envelope unwrapping, and response parsing live in one place.
 */
async function postMessage(
  phoneNumberId: string,
  accessToken: string,
  body: Record<string, unknown>,
): Promise<SendResult> {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(phoneNumberId)}/messages`;
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      // Meta typically replies in <2s; cap at 20s to keep the job worker
      // from hanging on a stalled connection. AbortController gives us
      // a hard timeout that fetch's default doesn't.
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Network failure";
    return { ok: false, status: 0, error: msg };
  }

  if (!resp.ok) {
    // Meta returns a JSON error envelope: { error: { message, code, ... } }.
    // Surface the message verbatim — most are operator-actionable
    // (token expired, recipient not on WhatsApp, 24h window closed,
    // template not approved).
    let errText = `HTTP ${resp.status}`;
    try {
      const j = (await resp.json()) as { error?: { message?: string } };
      if (j.error?.message) errText = `${errText}: ${j.error.message}`;
    } catch {
      /* leave errText as the bare status */
    }
    return { ok: false, status: resp.status, error: errText.slice(0, 500) };
  }

  // Success envelope: { messaging_product, contacts: [...], messages: [{ id }] }.
  try {
    const j = (await resp.json()) as { messages?: Array<{ id?: string }> };
    const id = j.messages?.[0]?.id;
    if (!id) return { ok: false, status: 502, error: "Meta accepted but returned no message id." };
    return { ok: true, messageId: id };
  } catch {
    return { ok: false, status: 502, error: "Meta returned an unparseable body." };
  }
}
