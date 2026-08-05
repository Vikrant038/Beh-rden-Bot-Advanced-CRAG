import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";
import { GUEST_COOKIE } from "@/lib/guest";

const { auth } = NextAuth(authConfig);

const PROTECTED_PREFIXES = ["/chat", "/history", "/settings", "/sources"];
const ADMIN_PREFIXES = ["/admin"];

/**
 * Generates a cryptographically random nonce for the current request.
 * Used to replace `unsafe-inline` in the CSP script-src directive so
 * only scripts carrying this nonce are executed.
 */
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

  const isProtected = PROTECTED_PREFIXES.some((prefix) => nextUrl.pathname.startsWith(prefix));
  const isAdminRoute = ADMIN_PREFIXES.some((prefix) => nextUrl.pathname.startsWith(prefix));

  if (isAdminRoute) {
    if (!isLoggedIn) {
      return NextResponse.redirect(new URL("/login", nextUrl));
    }
    if (role !== "ADMIN") {
      return NextResponse.redirect(new URL("/chat", nextUrl));
    }
  }

  if (isProtected && !isLoggedIn && !isGuest) {
    return NextResponse.redirect(new URL("/login", nextUrl));
  }

  // Generate a per-request nonce and forward it in a request header so
  // next.config.ts can embed it in the Content-Security-Policy and the
  // Next.js runtime can attach it to inline scripts.
  const nonce = generateNonce();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  // Attach the nonce-based CSP only in production. In development the
  // webpack hot-reload scripts don't carry nonces, so we allow unsafe-inline
  // there to avoid breaking the DX.
  if (process.env.NODE_ENV === "production") {
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}'`,
      // style-src: unsafe-inline is still required for Tailwind CSS v4's
      // runtime inline style injection. See docs/security/SECURITY_EXCEPTIONS.md.
      "style-src 'self' 'unsafe-inline'",
      // Google s2 favicon service feeds the 16px source chips (4.7).
      "img-src 'self' data: blob: https://www.google.com",
      "font-src 'self' data:",
      "connect-src 'self' https://api-inference.huggingface.co https://api.groq.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ");

    response.headers.set("Content-Security-Policy", csp);
    // Expose the nonce to the app layout so it can be set on <Script> tags.
    response.headers.set("x-nonce", nonce);
  }

  return response;
});

export const config = {
  matcher: [
    /*
     * Match all paths except static files and Next.js internals so the nonce
     * header is available on every HTML response.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
