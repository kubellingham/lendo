import { auth } from "@/lib/auth";

// Next.js 16 renamed `middleware` to `proxy` (nodejs runtime). We wrap the
// NextAuth handler so the JWT session is available as `req.auth`.
export const proxy = auth((req) => {
  const { pathname } = req.nextUrl;
  const isLoggedIn = !!req.auth;
  const isLoginPage = pathname === "/login";

  // Allow auth API and login page through.
  if (pathname.startsWith("/api/auth")) return;

  if (!isLoggedIn && !isLoginPage) {
    const url = new URL("/login", req.nextUrl);
    if (pathname !== "/") url.searchParams.set("callbackUrl", pathname);
    return Response.redirect(url);
  }

  if (isLoggedIn && isLoginPage) {
    return Response.redirect(new URL("/dashboard", req.nextUrl));
  }
});

export const config = {
  // Protect everything except Next internals, static assets, and the cron API
  // (the cron route authenticates with CRON_SECRET, not a session).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/cron|.*\\.svg).*)"],
};
