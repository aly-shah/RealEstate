import { auth } from "@/auth";
import { NextResponse } from "next/server";

// "/p/" (with the trailing slash) is the public client-facing property share
// page; the slash keeps it from matching /payments, /properties, /profile, etc.
const PUBLIC_PATHS = ["/login", "/p/"];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isLoggedIn = !!req.auth;
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  if (!isLoggedIn && !isPublic) {
    const url = new URL("/login", req.nextUrl);
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }

  // Logged-in user navigating to /login: usually bounce to /dashboard,
  // EXCEPT when the URL carries a `?reason=` flag (e.g. suspension), in which
  // case requireUser bounced them here on purpose to display a message.
  if (isLoggedIn && pathname === "/login" && !req.nextUrl.searchParams.has("reason")) {
    return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  // Run on everything except Next internals, NextAuth endpoints, static files,
  // and the machine-to-machine / public APIs (jobs cron, external webhooks, and
  // the token-scoped public property-media proxy) which carry their own auth and
  // must NOT bounce to /login.
  matcher: ["/((?!api/auth|api/jobs|api/webhooks|api/public|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
