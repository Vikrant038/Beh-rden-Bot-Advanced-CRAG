import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import Resend from "next-auth/providers/resend";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { authConfig } from "@/auth.config";
import { prisma } from "@/server/db";
import { env } from "@/server/env";

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
});
