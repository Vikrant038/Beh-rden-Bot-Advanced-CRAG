import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";
import { GUEST_COOKIE } from "@/config/app";

const { auth } = NextAuth(authConfig);

const PROTECTED_PREFIXES = ["/chat", "/history", "/settings", "/sources"];
const ADMIN_PREFIXES = ["/admin"];

/** Cryptographically random nonce so only scripts carrying it execute (no unsafe-inline). */
function generateNonce(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array));
}

export default auth((request) => {
  const { nextUrl } = request;
  const isLoggedIn = Boolean(request.auth);
  const role = request.auth?.user?.role;
  // Guest admission (3.10): presence of the signed guest cookie lets an
  // unauthenticated visitor through to the app surfaces. The signature itself
  // is verified server-side in the tRPC context, never here on the edge.
  const isGuest = Boolean(request.cookies.get(GUEST_COOKIE));

  const isAdminRoute = ADMIN_PREFIXES.some((p) => nextUrl.pathname.startsWith(p));
  const isProtected = PROTECTED_PREFIXES.some((p) => nextUrl.pathname.startsWith(p));

  if (isAdminRoute) {
    if (!isLoggedIn) return NextResponse.redirect(new URL("/login", nextUrl));
    if (role !== "ADMIN") return NextResponse.redirect(new URL("/chat", nextUrl));
  }
  if (isProtected && !isLoggedIn && !isGuest) {
    return NextResponse.redirect(new URL("/login", nextUrl));
  }

  // Per-request nonce forwarded in a request header so next.config.ts can
  // embed it in the CSP and Next.js can attach it to inline scripts.
  const nonce = generateNonce();
  const requestHeaders = new Headers(request.headers);

  // Nonce-based CSP only in production: dev hot-reload scripts don't carry
  // nonces, so we allow unsafe-inline there to keep DX working.
  if (process.env.NODE_ENV === "production") {
    // style-src unsafe-inline: required by Tailwind v4 runtime style injection
    // (docs/security/SECURITY_EXCEPTIONS.md). img-src google.com: favicon chips (4.7).
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}'`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://www.google.com",
      "font-src 'self' data:",
      "connect-src 'self' https://api-inference.huggingface.co https://api.groq.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ");

    // CRITICAL: the CSP must ALSO be forwarded on the request, not only the
    // response. Next.js app-render reads the nonce from
    // req.headers['content-security-policy'] and stamps its inline bootstrap
    // scripts (__next_f, theme init, hydration). Without it every inline
    // script is blocked and the page renders blank. The response header below
    // is what the browser enforces.
    requestHeaders.set("Content-Security-Policy", csp);
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  if (process.env.NODE_ENV === "production") {
    response.headers.set("Content-Security-Policy", requestHeaders.get("Content-Security-Policy")!);
    // Expose the nonce to the app layout so it can be set on <Script> tags.
    response.headers.set("x-nonce", nonce);
  }

  return response;
});

export const config = {
  // All paths except static files and Next.js internals, so the nonce header
  // is available on every HTML response.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
