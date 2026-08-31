import { createHmac, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { env } from "@/server/env";
import { prisma } from "@/server/db";
import { GUEST_COOKIE } from "@/config/app";

/**
 * Guest-mode identity (3.10).
 *
 * An unauthenticated visitor is admitted with a device-scoped guest id carried
 * in a signed cookie (`behoerden_guest`). The value is `<id>.<hmac>` so the id
 * cannot be forged: without the HMAC a cookie is rejected, which prevents
 * claiming another user's id (ids double as the User primary key).
 *
 * The guest id IS the user id — a lazy `User.upsert` in the tRPC
 * `isAuthenticated` middleware provisions the row on first access so
 * conversation FKs resolve. Guests get the plain USER role (never admin).
 */

export function createGuestId(): string {
  return crypto.randomUUID();
}

function sign(value: string): string {
  return createHmac("sha256", env.NEXTAUTH_SECRET).update(value).digest("base64url");
}

/** Returns the `<id>.<signature>` value stored in the guest cookie. */
export function createGuestCookieValue(id: string): string {
  return `${id}.${sign(id)}`;
}

/** Returns the verified guest id, or null when absent, malformed, or forged. */
export function verifyGuestCookieValue(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const separator = value.lastIndexOf(".");
  if (separator <= 0) {
    return null;
  }
  const id = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  if (!id || id.length > 128) {
    return null;
  }
  const expectedBuf = Buffer.from(sign(id));
  const providedBuf = Buffer.from(signature);
  // timingSafeEqual throws on length mismatch, so check length first.
  return providedBuf.length === expectedBuf.length && timingSafeEqual(providedBuf, expectedBuf)
    ? id
    : null;
}

/** Stable synthetic email for a guest User row (unique per device). */
export function guestEmail(id: string): string {
  return `guest:${id}@local`;
}

/** Reads and verifies the guest id from a Request's cookie header. */
export function readGuestIdFromRequest(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    return null;
  }
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${GUEST_COOKIE}=([^;]+)`));
  if (!match?.[1]) {
    return null;
  }
  let raw: string;
  try {
    raw = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  return verifyGuestCookieValue(raw);
}

/**
 * Returns a `Set-Cookie` header value that expires the guest cookie, for
 * responses assembled outside the Next.js `cookies()` API (e.g. tRPC context).
 */
export function clearGuestCookieHeader(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${GUEST_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}

/**
 * Transfers a guest's data to a real account after sign-in: conversations and
 * feedback rows are re-parented to `targetUserId`, then the now-empty guest
 * User row is deleted so the synthetic account doesn't accumulate. Throws if
 * the transfer fails so the caller can retry on the next request (the guest
 * cookie is only cleared on success).
 */
export async function claimGuestData(guestId: string, targetUserId: string): Promise<boolean> {
  if (guestId === targetUserId) {
    return false;
  }
  await Promise.all([
    prisma.conversation.updateMany({
      where: { userId: guestId },
      data: { userId: targetUserId },
    }),
    claimGuestFeedback(guestId, targetUserId),
  ]);
  // Deleting the guest row is best-effort: a concurrent request may already
  // have deleted it (P2025), which is fine — the data has been re-parented.
  await prisma.user.delete({ where: { id: guestId } }).catch(() => undefined);
  return true;
}

/**
 * Re-parents a guest's message feedback. A `(messageId, userId)` unique
 * collision is theoretically possible if the account already rated the same
 * message (e.g. data landed on a shared device); in that case the account's
 * rating wins and the guest's duplicate is dropped rather than aborting the
 * whole claim.
 */
async function claimGuestFeedback(guestId: string, targetUserId: string): Promise<void> {
  try {
    await prisma.messageFeedback.updateMany({
      where: { userId: guestId },
      data: { userId: targetUserId },
    });
  } catch (error) {
    const isConflict =
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
    if (!isConflict) {
      throw error;
    }
    await prisma.messageFeedback.deleteMany({
      where: {
        userId: guestId,
        message: { feedback: { some: { userId: targetUserId } } },
      },
    });
    await prisma.messageFeedback.updateMany({
      where: { userId: guestId },
      data: { userId: targetUserId },
    });
  }
}
