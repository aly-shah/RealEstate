import { cookies } from "next/headers";

/**
 * One-shot "flash" message that survives one navigation. Server actions call
 * `setFlash()` to queue a toast; the (app) layout calls `readFlash()` to read
 * it, and the Toaster component renders it and clears the cookie client-side.
 *
 * Cookie-based instead of URL-state because:
 *  - revalidatePath() flows don't navigate, so a URL param would never reach the next render
 *  - cookies cleanly survive a redirect AND a revalidation
 *  - the message never leaks into shareable URLs / browser history
 */

export type FlashTone = "ok" | "warn" | "danger" | "info";

export interface FlashMessage {
  message: string;
  tone: FlashTone;
  /** Optional click-through target — surface on the toast itself. */
  href?: string;
}

const COOKIE = "pz-flash";

/**
 * Queue a flash message. Safe to call from server actions and route handlers.
 * Truncates messages to 240 chars so a runaway payload can't bloat the cookie.
 */
export async function setFlash(input: FlashMessage): Promise<void> {
  const safe: FlashMessage = {
    message: String(input.message).slice(0, 240),
    tone: input.tone,
    ...(input.href ? { href: input.href.slice(0, 240) } : {}),
  };
  const store = await cookies();
  store.set(COOKIE, JSON.stringify(safe), {
    // NOT httpOnly: the Toaster clears this cookie client-side after showing it.
    // Next 16 forbids modifying cookies during the layout render, so the read
    // side (readFlash) can't clear it. It only ever holds a short UI toast string.
    sameSite: "lax",
    path: "/",
    // 10s is plenty for the next render; if a redirect somehow takes longer,
    // the toast is stale anyway and skipping it is the right call.
    maxAge: 10,
  });
}

/** The client-readable cookie name (the Toaster clears it after display). */
export const FLASH_COOKIE = COOKIE;

/**
 * Read the queued flash (read-only). Returns null when nothing is queued.
 * Called once per render from the (app) layout. Does NOT clear the cookie —
 * Next 16 forbids cookie writes during render — so the Toaster clears it
 * client-side after showing it, keeping the message show-once.
 */
export async function readFlash(): Promise<FlashMessage | null> {
  const store = await cookies();
  const raw = store.get(COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as FlashMessage;
    if (!parsed?.message || !parsed?.tone) return null;
    return parsed;
  } catch {
    return null;
  }
}
