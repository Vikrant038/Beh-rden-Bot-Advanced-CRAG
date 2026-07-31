import type { NextAuthConfig } from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";

/**
 * Edge-safe auth config (no adapter / no Node-only providers).
 * Used by middleware; the full config in server/auth.ts extends this with
 * PrismaAdapter + Resend for the Node runtime.
 */
export const authConfig = {
  providers: [GitHub, Google],
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
