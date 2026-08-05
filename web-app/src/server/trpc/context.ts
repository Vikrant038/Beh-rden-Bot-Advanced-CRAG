import { auth } from "@/server/auth";
import { prisma } from "@/server/db";
import { claimGuestData, clearGuestCookieHeader, readGuestIdFromRequest } from "@/server/guest";
import { createLogger } from "@/server/lib/logger";

const logger = createLogger("trpc-context");

export async function createTRPCContext(opts: { req: Request; resHeaders: Headers }) {
  const session = await auth();

  // Guest admission (3.10): when there is no real session, resolve the signed
  // device-scoped guest cookie. `isAuthenticated` provisions the User row and
  // builds an AuthedUser from it.
  const cookieGuestId = readGuestIdFromRequest(opts.req);

  // Post-sign-in claim (3.10): when a real session AND a guest cookie coexist,
  // the user just signed in from guest mode. Move the guest's conversations and
  // feedback under the account id, then clear the cookie so the claim runs at
  // most once. Best-effort: on failure the cookie stays and the claim retries
  // on the next request.
  if (session?.user?.id && cookieGuestId) {
    try {
      const claimed = await claimGuestData(cookieGuestId, session.user.id);
      if (claimed) {
        opts.resHeaders.append("Set-Cookie", clearGuestCookieHeader());
      }
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "[AUTH] guest data claim failed; will retry on next request",
      );
    }
  }

  const guestId = session?.user?.id ? null : cookieGuestId;

  return {
    db: prisma,
    session,
    guestId,
    headers: opts.req.headers,
    resHeaders: opts.resHeaders,
  };
}

export type Context = Awaited<ReturnType<typeof createTRPCContext>>;
