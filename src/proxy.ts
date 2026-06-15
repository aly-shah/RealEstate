// Next.js Proxy (the file convention formerly called `middleware`): runs on the
// server before a request is rendered. Here it's the auth gate that bounces
// anonymous traffic to /login, except for the public paths below.
import { auth } from "@/auth";
import { NextResponse } from "next/server";

// "/p/" (with the trailing slash) is the public client-facing property share
// page; the slash keeps it from matching /payments, /properties, /profile, etc.
// "/verify-identity/" is the public CNIC scanner reached from a WhatsApp link.
// "/portal/" is the login-free client portal.
const PUBLIC_PATHS = ["/login", "/p/", "/verify-identity/", "/portal/"];

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
  // and the machine-to-machine / public APIs (jobs cron, external webhooks, the
  // token-scoped public property-media proxy, and the token-scoped CNIC verify
  // endpoint) which carry their own auth and must NOT bounce to /login.
  matcher: ["/((?!api/auth|api/jobs|api/webhooks|api/public|api/contracts|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
