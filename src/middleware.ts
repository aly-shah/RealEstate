import { auth } from "@/auth";
import { NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login"];

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
  // and the machine-to-machine APIs (jobs cron + external webhooks) which
  // carry their own bearer/signature auth and must NOT bounce to /login.
  matcher: ["/((?!api/auth|api/jobs|api/webhooks|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
