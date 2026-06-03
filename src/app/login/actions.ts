"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { rateLimit, resetRateLimit, formatRetryAfter } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-meta";

export type LoginState = { error?: string };

/**
 * Rate-limit budget for the credentials login endpoint.
 *
 * Two layered limits trip from different angles:
 *  - per-IP: blunts a single host trying many accounts
 *  - per-(IP+email): blunts password-spray of one account from one host
 *
 * Bumping a limit returns a friendly "try again in N minutes" message rather
 * than reaching bcrypt at all — saves CPU and gives no oracle about whether
 * the email exists.
 */
const IP_LIMIT = 30;
const IP_WINDOW_MS = 15 * 60 * 1000;
const PAIR_LIMIT = 6;
const PAIR_WINDOW_MS = 15 * 60 * 1000;

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const ip = await clientIp();

  // Cheapest check first — per-IP cap (covers credential spray with many emails).
  const ipCheck = rateLimit({
    key: `login:ip:${ip}`,
    limit: IP_LIMIT,
    windowMs: IP_WINDOW_MS,
  });
  if (!ipCheck.allowed) {
    return {
      error: `Too many login attempts from this network. Try again in ${formatRetryAfter(ipCheck.retryAfterMs)}.`,
    };
  }

  // Tighter cap on the same (ip, email) pair — covers single-account brute force.
  if (email) {
    const pairCheck = rateLimit({
      key: `login:pair:${ip}:${email}`,
      limit: PAIR_LIMIT,
      windowMs: PAIR_WINDOW_MS,
    });
    if (!pairCheck.allowed) {
      return {
        error: `Too many attempts for this account. Try again in ${formatRetryAfter(pairCheck.retryAfterMs)}.`,
      };
    }
  }

  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: "/dashboard",
    });
    // Successful login — forgive prior failed-attempt counters for this pair
    // so legitimate "I mistyped twice" users aren't penalised next time.
    if (email) resetRateLimit(`login:pair:${ip}:${email}`);
    return {};
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Invalid email or password." };
    }
    // signIn throws a redirect on success — let Next handle it.
    throw error;
  }
}
