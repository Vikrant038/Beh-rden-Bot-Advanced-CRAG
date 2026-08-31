import { vi, describe, it, expect, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/server/db", () => ({
  prisma: {
    user: { create: vi.fn(), findUnique: vi.fn() },
    conversation: { findMany: vi.fn() },
    message: { findMany: vi.fn() },
  },
}));

import { appRouter } from "@/server/trpc/router";
import type { Context } from "@/server/trpc/context";
import { prisma } from "@/server/db";
import type { MockPrisma } from "../helpers/mock-prisma";
import { makeGuestCaller } from "../helpers/caller";

const prismaMock = prisma as unknown as MockPrisma;

/** Guest caller by id; `overrides` replaces whole context fields (session tests). */
const makeCaller = (
  guestId?: string,
  overrides: Partial<Context> = {},
): ReturnType<typeof appRouter.createCaller> =>
  overrides.session !== undefined
    ? appRouter.createCaller({
        db: prismaMock as never,
        session: null,
        guestId: undefined,
        headers: new Headers(),
        resHeaders: new Headers(),
        ...overrides,
      } as unknown as Context)
    : makeGuestCaller(prismaMock, guestId);

describe("guest admission (isAuthenticated)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.conversation.findMany.mockResolvedValue([] as never);
  });

  it("admits a valid guest cookie and provisions the guest User row lazily", async () => {
    prismaMock.user.create.mockResolvedValue({ id: "guest-1" } as never);
    const caller = makeCaller("guest-1");

    await caller.conversation.list({ limit: 10 });

    // The guest user row is provisioned once with the signed id and a stable
    // synthetic email.
    expect(prismaMock.user.create).toHaveBeenCalledWith({
      data: { id: "guest-1", email: "guest:guest-1@local", name: "Guest" },
    });
    // Procedures run under the guest's user id (the signed cookie value).
    expect(prismaMock.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "guest-1", deletedAt: null }),
      }),
    );
  });

  it("treats a re-used device cookie (P2002) as already-provisioned", async () => {
    prismaMock.user.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    const caller = makeCaller("guest-1");

    const result = await caller.conversation.list({ limit: 10 });
    expect(result.items).toEqual([]);
  });

  it("rejects with UNAUTHORIZED when guest provisioning fails for another reason", async () => {
    prismaMock.user.create.mockRejectedValue(new Error("db down"));
    const caller = makeCaller("guest-1");

    await expect(caller.conversation.list({ limit: 10 })).rejects.toThrow("db down");
  });

  it("rejects with UNAUTHORIZED when there is neither a session nor a guest id", async () => {
    const caller = makeCaller();
    await expect(caller.conversation.list({ limit: 10 })).rejects.toThrow();
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("rejects with UNAUTHORIZED when session user is not found in database", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null as never);
    const caller = makeCaller(undefined, {
      session: { user: { id: "missing-user" }, expires: "2099-01-01" },
    } as Partial<Context>);

    await expect(caller.conversation.list({ limit: 10 })).rejects.toThrow();
  });

  it("rejects with FORBIDDEN when user account is blocked", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      role: "USER",
      blockedAt: new Date(),
    } as never);
    const caller = makeCaller(undefined, {
      session: { user: { id: "blocked-user" }, expires: "2099-01-01" },
    } as Partial<Context>);

    await expect(caller.conversation.list({ limit: 10 })).rejects.toThrow(
      "This account has been blocked",
    );
  });

  it("handles non-Error throw during guest user creation", async () => {
    prismaMock.user.create.mockRejectedValue("string error");
    const caller = makeCaller("guest-err");

    await expect(caller.conversation.list({ limit: 10 })).rejects.toThrow("Invalid guest session");
  });
});
