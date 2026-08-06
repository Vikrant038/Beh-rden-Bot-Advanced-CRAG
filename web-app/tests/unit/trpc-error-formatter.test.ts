import { vi, describe, it, expect, beforeEach } from "vitest";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/context";

vi.mock("@/server/db", () => ({
  prisma: {
    conversation: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    message: { count: vi.fn(), deleteMany: vi.fn() },
    user: { create: vi.fn() },
  },
}));

// createTRPCContext pulls in next-auth, which trips over next/server module
// resolution under vitest; the formatter is part of the router, not the
// context, so a stub context is sufficient for these assertions. The guestId
// is mutable so the UNAUTHORIZED branch (no session, no guest) can be hit.
let contextGuestId: string | null = "guest-1";

vi.mock("@/server/trpc/context", () => ({
  createTRPCContext: vi.fn(async () => ({
    db: {},
    session: null,
    guestId: contextGuestId,
    headers: new Headers(),
    resHeaders: new Headers(),
  })),
}));

import { prisma } from "@/server/db";
import type { MockPrisma } from "../helpers/mock-prisma";

const prismaMock = prisma as unknown as MockPrisma;

/**
 * Invokes the real fetch adapter (the same code path as the Next.js route)
 * with a non-batched POST mutation body (tRPC v11: body = input directly),
 * so the errorFormatter in src/server/trpc/t.ts runs and maps error codes.
 */
async function callMutation(
  path: string,
  input: unknown,
): Promise<{ json: () => Promise<unknown> }> {
  const request = new Request(`http://localhost/api/trpc/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const response = (await fetchRequestHandler({
    endpoint: "/api/trpc",
    req: request,
    router: appRouter,
    createContext: (opts) => createTRPCContext({ req: opts.req, resHeaders: opts.resHeaders }),
  })) as unknown as { json: () => Promise<unknown> };
  return response;
}

/** Digs the `data.code` out of the v11 error envelope regardless of wrapping. */
function extractErrorCode(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const root = payload as Record<string, unknown>;
  const error = root.error as
    { json?: { data?: { code?: string } }; data?: { code?: string } } | undefined;
  return error?.json?.data?.code ?? error?.data?.code;
}

beforeEach(() => {
  vi.clearAllMocks();
  contextGuestId = "guest-1";
  prismaMock.user.create.mockResolvedValue({ id: "guest-1" } as never);
});

describe("tRPC errorFormatter", () => {
  it("maps a DomainError cause to its code (NOT_FOUND)", async () => {
    // conversation.restore throws NotFoundError when the row is missing.
    prismaMock.conversation.findFirst.mockResolvedValue(null as never);

    const response = await callMutation("conversation.restore", { id: "ghost" });
    const payload = (await response.json()) as { error?: { data?: { code?: string } } };
    const code = extractErrorCode(payload);
    expect(code).toBe("NOT_FOUND");
  });

  it("maps a ZodError cause to VALIDATION_FAILED", async () => {
    // setPinned requires { id, pinned } — missing `pinned` fails zod.
    const response = await callMutation("conversation.setPinned", { id: "c1" });
    const payload = (await response.json()) as { error?: { data?: { code?: string } } };
    const code = extractErrorCode(payload);
    expect(code).toBe("VALIDATION_FAILED");
  });

  it("passes through the default code for a plain TRPCError", async () => {
    // No guestId and no session => UNAUTHORIZED from the middleware (not a
    // DomainError, not a ZodError) — the formatter must keep the base code.
    contextGuestId = null;

    const response = await callMutation("conversation.restore", { id: "x" });
    const payload = (await response.json()) as { error?: { data?: { code?: string } } };
    const code = extractErrorCode(payload);
    expect(code).toBe("UNAUTHORIZED");
  });
});
