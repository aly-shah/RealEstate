import { headers } from "next/headers";

/**
 * Best-effort client-IP extraction. nginx is configured to set
 * `X-Forwarded-For` (see deploy/setup.sh), so the first entry of that header
 * is the real client. Falls back to `X-Real-IP` and finally "unknown".
 */
export async function clientIp(): Promise<string> {
  try {
    const h = await headers();
    const xff = h.get("x-forwarded-for");
    if (xff) return xff.split(",")[0]!.trim();
    return h.get("x-real-ip") ?? "unknown";
  } catch {
    // headers() throws outside request context (e.g. seed scripts).
    return "unknown";
  }
}

// Pre-compile the control-character regex from char codes so the source text
// itself stays clean ASCII (some tools mangle inline control chars).
const CONTROL_CHARS_RE = new RegExp(
  "[" + String.fromCharCode(0) + "-" + String.fromCharCode(31) + String.fromCharCode(127) + "]",
  "g",
);

/** Sanitised User-Agent (capped, control characters stripped). */
export async function userAgent(): Promise<string | null> {
  try {
    const h = await headers();
    const ua = h.get("user-agent");
    if (!ua) return null;
    return ua.replace(CONTROL_CHARS_RE, "").slice(0, 240);
  } catch {
    return null;
  }
}
