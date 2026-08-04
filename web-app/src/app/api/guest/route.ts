import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { createGuestCookieValue, createGuestId } from "@/server/guest";
import { GUEST_COOKIE, GUEST_MAX_AGE_SECONDS } from "@/lib/guest";

export const runtime = "nodejs";

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

/**
 * Guest admission (3.10): issues a signed device-scoped guest cookie.
 * Rejected with 409 when the caller already holds a real session — a signed-in
 * user should never be silently downgraded to guest mode.
 */
export async function POST() {
  const session = await auth();
  if (session?.user?.id) {
    return NextResponse.json({ ok: false, error: "Already signed in" }, { status: 409 });
  }

  const guestId = createGuestId();
  const response = NextResponse.json({ ok: true, guestId });
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
