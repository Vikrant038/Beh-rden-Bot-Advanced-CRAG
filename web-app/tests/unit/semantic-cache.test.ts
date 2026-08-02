import { vi, describe, it, expect, beforeEach } from "vitest";
import { SemanticCache } from "@/server/rag/cache/semantic-cache";

vi.mock("@/server/db", async () => {
  const prisma = {
    semanticCacheEntry: {
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
  };
  return { prisma };
});

import { prisma } from "@/server/db";

const mockedFindUnique = vi.mocked(prisma.semanticCacheEntry.findUnique);
const mockedQueryRaw = vi.mocked(prisma.$queryRaw);
const mockedFindMany = vi.mocked(prisma.semanticCacheEntry.findMany);
const mockedDeleteMany = vi.mocked(prisma.semanticCacheEntry.deleteMany);

function makeVector(dim = 3, value = 0.1): number[] {
  return Array.from({ length: dim }, (_, i) => value + i * 0.01);
}

describe("SemanticCache", () => {
  const cache = new SemanticCache(0.97, 7 * 24 * 3600);
  const now = new Date();
  const future = new Date(now.getTime() + 86_400_000);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return null on miss", async () => {
    mockedFindUnique.mockResolvedValue(null);
    mockedQueryRaw.mockResolvedValue([]);
    const result = await cache.checkCache("visa requirements", makeVector(3));
    expect(result).toBeNull();
  });

  it("should store and return an entry on hit", async () => {
    mockedFindUnique.mockResolvedValue({
      queryHash: "abc",
      queryText: "visa",
      responseJson: { answer: "Blocked account: 11904 EUR", sources: [] },
      parentDocIds: [],
      createdAt: now,
      expiresAt: future,
    } as never);

    const result = await cache.checkCache("visa", makeVector(3));
    expect(result?.answer).toBe("Blocked account: 11904 EUR");
    expect(result?.retrievalPath).toContain("TIER_1_EXACT");
  });

  it("should match cosine similarity >= threshold", async () => {
    mockedFindUnique.mockResolvedValue(null);
    mockedQueryRaw.mockResolvedValue([{ responseJson: { answer: "ok", sources: [] }, sim: 0.98 }]);

    const result = await cache.checkCache("blocked account", makeVector(3));
    expect(result?.isCached).toBe(true);
    expect(result?.retrievalPath).toContain("TIER_2_VECTOR");
  });

  it("should return null for below-threshold similarity", async () => {
    mockedFindUnique.mockResolvedValue(null);
    mockedQueryRaw.mockResolvedValue([{ responseJson: { answer: "ok", sources: [] }, sim: 0.5 }]);

    const result = await cache.checkCache("blocked account", makeVector(3));
    expect(result).toBeNull();
  });

  it("should return null for expired entries (TTL enforced)", async () => {
    const expired = new Date(now.getTime() - 86_400_000);
    mockedFindUnique.mockResolvedValue({
      queryHash: "abc",
      queryText: "visa",
      responseJson: { answer: "old", sources: [] },
      parentDocIds: [],
      createdAt: now,
      expiresAt: expired,
    } as never);

    const result = await cache.checkCache("visa", makeVector(3));
    expect(result).toBeNull();
  });

  it("should invalidate entries by parentDocIds", async () => {
    mockedFindMany.mockResolvedValue([
      {
        id: 1,
        createdAt: now,
        queryHash: "a",
        queryText: "t",
        responseJson: {},
        parentDocIds: [],
        expiresAt: future,
      },
      {
        id: 2,
        createdAt: now,
        queryHash: "b",
        queryText: "t",
        responseJson: {},
        parentDocIds: [],
        expiresAt: future,
      },
    ] as never);
    mockedDeleteMany.mockResolvedValue({ count: 2 });

    const count = await cache.invalidateForDocument("doc-1");
    expect(count).toBe(2);
  });

  it("addToCache should upsert via single $executeRaw (atomic ON CONFLICT)", async () => {
    vi.mocked(prisma.$executeRaw).mockResolvedValue(1);

    await cache.addToCache(
      "visa requirements",
      makeVector(3),
      { answer: "Blocked account total: EUR 11904.", sources: [{ name: "d", url: "u", score: 0.9 }] },
      ["doc-1"],
    );

    // Atomic upsert: $executeRaw called once, findUnique never called
    expect(prisma.$executeRaw).toHaveBeenCalledOnce();
    expect(mockedFindUnique).not.toHaveBeenCalled();
  });

  it("addToCache should use same upsert path whether entry exists or not", async () => {
    const update = vi.mocked(prisma.semanticCacheEntry.update);
    vi.mocked(prisma.$executeRaw).mockResolvedValue(1);

    await cache.addToCache("visa requirements", makeVector(3), {
      answer: "Blocked account total: EUR 11904.",
      sources: [],
    });

    // No separate UPDATE call — the ON CONFLICT clause handles updates inside $executeRaw
    expect(update).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).toHaveBeenCalledOnce();
  });

  it("clearAll should delete many and return true", async () => {
    const deleteMany = vi.mocked(prisma.semanticCacheEntry.deleteMany);
    deleteMany.mockResolvedValue({ count: 0 });
    expect(await cache.clearAll()).toBe(true);
    expect(deleteMany).toHaveBeenCalled();
  });

  it("checkCache should swallow query errors and return null", async () => {
    mockedFindUnique.mockRejectedValue(new Error("db down"));
    const result = await cache.checkCache("visa", makeVector(3));
    expect(result).toBeNull();
  });

  it("should return null when no queryVector provided", async () => {
    mockedFindUnique.mockResolvedValue(null);
    const result = await cache.checkCache("visa", null);
    expect(result).toBeNull();
  });
});
