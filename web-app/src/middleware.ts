import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";

const { auth } = NextAuth(authConfig);

const PROTECTED_PREFIXES = ["/chat", "/history", "/settings", "/sources"];
const ADMIN_PREFIXES = ["/admin"];

export default auth((request) => {
  const { nextUrl } = request;
  const isLoggedIn = Boolean(request.auth);
  const role = request.auth?.user?.role;

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

  if (isProtected && !isLoggedIn) {
    return NextResponse.redirect(new URL("/login", nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/chat/:path*", "/history", "/settings", "/sources", "/admin/:path*"],
};
