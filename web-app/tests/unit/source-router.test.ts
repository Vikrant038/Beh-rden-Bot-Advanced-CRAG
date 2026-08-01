import { vi, describe, it, expect, beforeEach } from "vitest";
import { appRouter } from "@/server/trpc/router";
import type { Context } from "@/server/trpc/context";

vi.mock("@/server/db", () => ({
  prisma: {
    document: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    documentChunk: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/server/db";
import type { MockPrisma } from "../helpers/mock-prisma";

const prismaMock = prisma as unknown as MockPrisma;

function makeCaller() {
  return appRouter.createCaller({
    db: prismaMock as never,
    session: {
      user: { id: "user-1", role: "USER", name: "Test", email: "test@example.com" },
      expires: "2099-01-01T00:00:00.000Z",
    },
    headers: new Headers(),
    resHeaders: new Headers(),
  } as unknown as Context);
}

describe("source router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("list: returns indexed documents with chunk counts", async () => {
    prismaMock.document.findMany.mockResolvedValue([
      { id: "d1", title: "Blocked Account", url: "https://example.com", chunkCount: 12, updatedAt: new Date(), createdAt: new Date() },
    ] as never);

    const caller = makeCaller();
    const result = await caller.source.list();

    expect(result).toHaveLength(1);
    expect(result[0].chunkCount).toBe(12);
    expect(prismaMock.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { updatedAt: "desc" } }),
    );
  });

  it("getChunks: returns paginated chunks for a document", async () => {
    prismaMock.document.findUnique.mockResolvedValue({ id: "d1" } as never);
    prismaMock.documentChunk.findMany.mockResolvedValue([
      { id: 1, sourceName: "doc", sourceUrl: "https://example.com", text: "chunk one", createdAt: new Date() },
      { id: 2, sourceName: "doc", sourceUrl: "https://example.com", text: "chunk two", createdAt: new Date() },
    ] as never);

    const caller = makeCaller();
    const result = await caller.source.getChunks({ documentId: "d1", limit: 1 });

    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBe(2);
  });

  it("getChunks: throws when the document does not exist", async () => {
    prismaMock.document.findUnique.mockResolvedValue(null as never);
    const caller = makeCaller();
    await expect(caller.source.getChunks({ documentId: "nope", limit: 10 })).rejects.toThrow();
  });
});
