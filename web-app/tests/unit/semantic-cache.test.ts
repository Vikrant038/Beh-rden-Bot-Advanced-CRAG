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

function makeVector(dim = 1024, value = 0.1): number[] {
  return Array.from({ length: dim }, (_, i) => value + i * 0.001);
}

describe("SemanticCache", () => {
  const cache = new SemanticCache(0.97, 7 * 24 * 3600);
  const now = new Date();
  const future = new Date(now.getTime() + 86_400_000);

  /** A stored tier-1 cache row (responseJson + expiry are what checkCache reads). */
  const tier1Row = (overrides: Record<string, unknown> = {}) => ({
    queryHash: "abc",
    queryText: "visa",
    responseJson: { answer: "old", sources: [] },
    parentDocIds: [],
    createdAt: now,
    expiresAt: future,
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return null on miss", async () => {
    mockedFindUnique.mockResolvedValue(null);
    mockedQueryRaw.mockResolvedValue([]);
    const result = await cache.checkCache("visa requirements", makeVector());
    expect(result).toBeNull();
  });

  it("should store and return an entry on hit", async () => {
    mockedFindUnique.mockResolvedValue(
      tier1Row({
        responseJson: { answer: "Blocked account: 11904 EUR", sources: [] },
        language: "en",
      }) as never,
    );

    const result = await cache.checkCache("visa", makeVector());
    expect(result?.answer).toBe("Blocked account: 11904 EUR");
    expect(result?.retrievalPath).toContain("TIER_1_EXACT");
    // The language the cached answer was written in rides along on the hit.
    expect(result?.language).toBe("en");
  });

  it("returns the stored language on a tier-1 hit with a null language", async () => {
    mockedFindUnique.mockResolvedValue(tier1Row({ language: null }) as never);

    const result = await cache.checkCache("visa", makeVector());
    // Pre-migration rows have no language — the hit stays usable, just unlabeled.
    expect(result?.language).toBeUndefined();
  });

  it("should match cosine similarity >= threshold", async () => {
    mockedFindUnique.mockResolvedValue(null);
    mockedQueryRaw.mockResolvedValue([
      { responseJson: { answer: "ok", sources: [] }, sim: 0.98, language: "de" },
    ]);

    const result = await cache.checkCache("blocked account", makeVector());
    expect(result?.isCached).toBe(true);
    expect(result?.retrievalPath).toContain("TIER_2_VECTOR");
    expect(result?.language).toBe("de");
  });

  it("should return null for below-threshold similarity", async () => {
    mockedFindUnique.mockResolvedValue(null);
    mockedQueryRaw.mockResolvedValue([
      { responseJson: { answer: "ok", sources: [] }, sim: 0.5, language: null },
    ]);

    const result = await cache.checkCache("blocked account", makeVector());
    expect(result).toBeNull();
  });

  it("should return null for expired entries (TTL enforced)", async () => {
    const expired = new Date(now.getTime() - 86_400_000);
    mockedFindUnique.mockResolvedValue(tier1Row({ expiresAt: expired }) as never);

    const result = await cache.checkCache("visa", makeVector());
    expect(result).toBeNull();
  });

  it("should invalidate entries by parentDocIds", async () => {
    mockedFindMany.mockResolvedValue([
      tier1Row({ id: 1, queryHash: "a" }),
      tier1Row({ id: 2, queryHash: "b" }),
    ] as never);
    mockedDeleteMany.mockResolvedValue({ count: 2 });

    const count = await cache.invalidateForDocument("doc-1");
    expect(count).toBe(2);
  });

  it("addToCache should upsert via single $executeRaw (atomic ON CONFLICT)", async () => {
    vi.mocked(prisma.$executeRaw).mockResolvedValue(1);

    await cache.addToCache(
      "visa requirements",
      makeVector(),
      {
        answer: "Blocked account total: EUR 11904.",
        sources: [{ name: "d", url: "u", score: 0.9 }],
      },
      ["doc-1"],
      "de",
    );

    // Atomic upsert: $executeRaw called once, findUnique never called
    expect(prisma.$executeRaw).toHaveBeenCalledOnce();
    expect(mockedFindUnique).not.toHaveBeenCalled();
    // The answer language is persisted with the entry.
    const callArgs = vi.mocked(prisma.$executeRaw).mock.calls[0] ?? [];
    expect(callArgs).toContain("de");
  });

  it("addToCache should use same upsert path whether entry exists or not", async () => {
    const update = vi.mocked(prisma.semanticCacheEntry.update);
    vi.mocked(prisma.$executeRaw).mockResolvedValue(1);

    await cache.addToCache("visa requirements", makeVector(), {
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
    const result = await cache.checkCache("visa", makeVector());
    expect(result).toBeNull();
  });

  it("should return null when no queryVector provided", async () => {
    mockedFindUnique.mockResolvedValue(null);
    const result = await cache.checkCache("visa", null);
    expect(result).toBeNull();
  });

  it("should return 0 when no cache entries match the document", async () => {
    mockedFindMany.mockResolvedValue([]);
    const count = await cache.invalidateForDocument("doc-none");
    expect(count).toBe(0);
    expect(mockedDeleteMany).not.toHaveBeenCalled();
  });
});
