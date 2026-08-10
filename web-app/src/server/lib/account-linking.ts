import { prisma } from "@/server/db";

/**
 * Shape of the Auth.js sign-in `account` param for OAuth/email providers —
 * the subset we persist on the Account row. Kept local so the helper is
 * decoupled from next-auth's exact types.
 */
export interface ProviderAccount {
  provider: string;
  type: string;
  providerAccountId: string;
  access_token?: string | null;
  refresh_token?: string | null;
  expires_at?: number | null;
  token_type?: string | null;
  scope?: string | null;
  id_token?: string | null;
}

/**
 * Auto-links a provider account to the existing user when the verified email
 * already belongs to a user created through a *different* provider.
 *
 * Why it exists: Auth.js v5 refuses to sign in when the provider account is
 * new but the email already has a user (e.g. GitHub first, then Google with
 * the same email) — it throws AccountNotLinked / OAuthAccountNotLinked.
 * GitHub, Google and the magic-link (Resend) provider all verify the email
 * before issuing a token, so an email match is a confirmed identity match and
 * linking is safe.
 *
 * Why it works: the signIn callback runs (via handleAuthorized) BEFORE
 * handleLoginOrRegister. Creating the Account row here means the adapter's
 * getUserByAccount lookup finds it, so Auth.js signs the user in as the
 * existing user instead of erroring.
 *
 * Idempotent and fail-safe: the upsert is keyed on the unique
 * (provider, providerAccountId); any error is swallowed by the caller so a
 * linking hiccup can never block sign-in.
 *
 * @returns true when the account was linked to an existing user, false when
 * there was nothing to link (new user, or no email on the provider profile).
 */
export async function autoLinkOAuthAccount(
  user: { email?: string | null },
  account: ProviderAccount | undefined | null,
): Promise<boolean> {
  if (!account || !account.providerAccountId || !user.email) {
    return false;
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: user.email },
    select: { id: true },
  });
  if (!existingUser) {
    return false;
  }

  await prisma.account.upsert({
    where: {
      provider_providerAccountId: {
        provider: account.provider,
        providerAccountId: account.providerAccountId,
      },
    },
    update: { userId: existingUser.id },
    create: {
      userId: existingUser.id,
      type: account.type,
      provider: account.provider,
      providerAccountId: account.providerAccountId,
      access_token: account.access_token ?? null,
      refresh_token: account.refresh_token ?? null,
      expires_at: account.expires_at ?? null,
      token_type: account.token_type ?? null,
      scope: account.scope ?? null,
      id_token: account.id_token ?? null,
    },
  });
  return true;
}
