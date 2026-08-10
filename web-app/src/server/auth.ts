import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import Resend from "next-auth/providers/resend";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { authConfig } from "@/auth.config";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { autoLinkOAuthAccount } from "@/server/lib/account-linking";

const providers: Provider[] = [...authConfig.providers];

if (env.RESEND_API_KEY) {
  providers.push(
    Resend({
      from: env.EMAIL_FROM ?? "Behoerden Bot <onboarding@resend.dev>",
      apiKey: env.RESEND_API_KEY,
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  providers,
  callbacks: {
    ...authConfig.callbacks,
    // Signing in with a second provider (e.g. Google after GitHub) used to
    // fail with AccountNotLinked / OAuthAccountNotLinked. Auto-link instead:
    // all our providers verify the email before issuing a token, so an email
    // match is a confirmed identity match. See server/lib/account-linking.ts.
    signIn: async ({ user, account }) => {
      try {
        await autoLinkOAuthAccount(user, account);
      } catch (error) {
        // Never block sign-in on a linking failure — fall through to the
        // default flow (Auth.js will surface the error if the account truly
        // cannot be linked).
        console.error("[AUTH] account auto-link failed", error);
      }
      // A blocked account must not be able to create a new session (even
      // though existing sessions are already rejected per-request by the tRPC
      // middleware and the chat stream route). Return false → Auth.js denies
      // the sign-in. The OAuth user object may not carry a DB id yet, so fall
      // back to the verified email.
      const blockLookup = user.id
        ? prisma.user.findUnique({ where: { id: user.id }, select: { blockedAt: true } })
        : user.email
          ? prisma.user.findUnique({ where: { email: user.email }, select: { blockedAt: true } })
          : null;
      if (blockLookup) {
        const dbUser = await blockLookup;
        if (dbUser?.blockedAt) {
          return false;
        }
      }
      return true;
    },
  },
});
