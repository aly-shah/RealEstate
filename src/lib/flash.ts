import { cookies } from "next/headers";

/**
 * One-shot "flash" message that survives one navigation. Server actions call
 * `setFlash()` to queue a toast; the (app) layout calls `consumeFlash()` to
 * read it (and immediately clear it). The Toaster component then renders it.
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
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    // 10s is plenty for the next render; if a redirect somehow takes longer,
    // the toast is stale anyway and skipping it is the right call.
    maxAge: 10,
  });
}

/**
 * Read + immediately clear the queued flash. Returns null when nothing is queued.
 * Called once per render from the (app) layout.
 */
export async function consumeFlash(): Promise<FlashMessage | null> {
  const store = await cookies();
  const raw = store.get(COOKIE)?.value;
  if (!raw) return null;
  // Clear by writing an empty cookie with maxAge: 0. Safer than .delete()
  // which has subtly different semantics in Next 16 across runtimes.
  store.set(COOKIE, "", { path: "/", maxAge: 0 });
  try {
    const parsed = JSON.parse(raw) as FlashMessage;
    if (!parsed?.message || !parsed?.tone) return null;
    return parsed;
  } catch {
    return null;
  }
}
