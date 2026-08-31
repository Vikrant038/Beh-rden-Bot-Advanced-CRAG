import { appRouter } from "@/server/trpc/router";
import type { Context } from "@/server/trpc/context";
import type { MockPrisma } from "./mock-prisma";

/**
 * Shared tRPC caller factories for router tests. All router tests mock
 * `@/server/db` with per-file factories (vi.mock is hoisted per file), but the
 * caller construction is identical everywhere — this is the one copy.
 *
 * `isAuthenticated` reads role + block status fresh from the DB, so the caller
 * factories stub `user.findUnique` with `{ role, blockedAt: null }`.
 */
export function makeUserCaller(
  prismaMock: Pick<MockPrisma, "user">,
  role: "USER" | "ADMIN" = "USER",
): ReturnType<typeof appRouter.createCaller> {
  prismaMock.user.findUnique.mockResolvedValue({ role, blockedAt: null } as never);
  return appRouter.createCaller({
    db: prismaMock as never,
    session: {
      user: { id: "user-1", role, name: "Test", email: "test@example.com" },
      expires: "2099-01-01T00:00:00.000Z",
    },
    headers: new Headers(),
    resHeaders: new Headers(),
  } as unknown as Context);
}

/**
 * A caller that goes through the guest admission path (no session, signed
 * device cookie). `isAuthenticated` lazily provisions the guest User row.
 * Pass `guestId` explicitly — no default, so `undefined` means "no guest
 * cookie" (the UNAUTHORIZED path).
 */
export function makeGuestCaller(
  prismaMock: Pick<MockPrisma, "user">,
  guestId: string | undefined,
): ReturnType<typeof appRouter.createCaller> {
  return appRouter.createCaller({
    db: prismaMock as never,
    session: null,
    guestId,
    headers: new Headers(),
    resHeaders: new Headers(),
  } as unknown as Context);
}
