import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { createGuestCookieValue, createGuestId, readGuestIdFromRequest } from "@/server/guest";
import { GUEST_COOKIE, GUEST_MAX_AGE_SECONDS } from "@/config/app";

export const runtime = "nodejs";

/** Same attributes the signed cookie is verified against in src/server/guest.ts. */
const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
} as const;

/**
 * Guest admission (3.10): issues a signed device-scoped guest cookie.
 * Idempotent — when a valid guest cookie already exists (e.g. the visitor
 * refreshed the login page or clicked "Continue as guest" again), the same
 * identity is reused instead of minting a fresh one. Minting a new id would
 * silently reset the guest's 5-prompt cap, since the cap counts USER messages
 * against the guest user id.
 * Rejected with 409 when the caller already holds a real session — a signed-in
 * user should never be silently downgraded to guest mode.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (session?.user?.id) {
    return NextResponse.json({ ok: false, error: "Already signed in" }, { status: 409 });
  }

  const existingGuestId = readGuestIdFromRequest(request);
  const guestId = existingGuestId ?? createGuestId();
  const response = NextResponse.json({ ok: true, guestId, reused: Boolean(existingGuestId) });
  response.cookies.set(GUEST_COOKIE, createGuestCookieValue(guestId), {
    ...COOKIE_OPTIONS,
    maxAge: GUEST_MAX_AGE_SECONDS,
  });
  return response;
}

/** Leaves guest mode by expiring the guest cookie. */
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(GUEST_COOKIE, "", { ...COOKIE_OPTIONS, maxAge: 0 });
  return response;
}
