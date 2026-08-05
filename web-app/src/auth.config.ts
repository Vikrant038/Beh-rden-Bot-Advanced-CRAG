import type { NextAuthConfig } from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import { env } from "@/server/env";

/**
 * Edge-safe auth config (no adapter / no Node-only providers).
 * Used by middleware; the full config in server/auth.ts extends this with
 * PrismaAdapter + Resend for the Node runtime.
 */
export const authConfig = {
  providers: [
    GitHub({
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
    }),
    Google({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  // NextAuth v5 reads AUTH_SECRET / AUTH_URL directly from process.env and an
  // EMPTY value (dashboards store unset vars as "") is NOT nullish — so it
  // would override the validated NEXTAUTH_SECRET with "" and break OAuth
  // callbacks with error=Configuration. Pin the values explicitly so the
  // ambient AUTH_* names are ignored entirely.
  secret: env.NEXTAUTH_SECRET,
  // trustHost lets Vercel's request Host header be used instead of requiring
  // a hardcoded AUTH_URL, which removes the malformed-AUTH_URL crash class.
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id ?? "";
        session.user.role = token.role ?? "USER";
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
