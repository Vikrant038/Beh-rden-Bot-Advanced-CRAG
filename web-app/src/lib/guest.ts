/**
 * Guest-mode constants, kept free of any Node-only imports so they can be
 * referenced from the Edge middleware and client components alike.
 */

/** HTTP-only cookie that carries the signed device-scoped guest identity. */
export const GUEST_COOKIE = "behoerden_guest";

/** How long a guest session persists on the device (180 days). */
export const GUEST_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

/**
 * Free-tier cap: a guest can hold at most this many (non-deleted) conversations
 * before being asked to sign in.
 */
export const GUEST_CONVERSATION_LIMIT = 5;

/**
 * Client-facing error code sent by the server when the guest cap is hit.
 * Must match `ErrorCode.GUEST_CONVERSATION_LIMIT` in
 * `src/server/lib/errors/codes.ts`.
 */
export const GUEST_LIMIT_REACHED_CODE = "GUEST_CONVERSATION_LIMIT";
