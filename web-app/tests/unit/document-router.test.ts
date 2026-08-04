import { vi, describe, it, expect, beforeEach } from "vitest";
import { appRouter } from "@/server/trpc/router";
import type { Context } from "@/server/trpc/context";

vi.mock("@/server/db", () => ({
  prisma: {
    document: {
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    documentChunk: {},
    semanticCacheEntry: {},
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/server/ingest/pipeline", () => ({
  ingestUrl: vi.fn(),
  syncAllDocuments: vi.fn(),
}));

vi.mock("@/server/rag/cache/semantic-cache", () => ({
  semanticCache: { invalidateForDocument: vi.fn() },
}));

vi.mock("@/server/rag/instance", () => ({
  getCorpusProvider: () => ({ invalidate: vi.fn() }),
}));

vi.mock("@/server/lib/security/url-validator", () => ({
  assertSafeUrl: vi.fn(),
}));

import { prisma } from "@/server/db";
import { ingestUrl, syncAllDocuments } from "@/server/ingest/pipeline";
import { semanticCache } from "@/server/rag/cache/semantic-cache";
import { assertSafeUrl } from "@/server/lib/security/url-validator";

const prismaMock = prisma as unknown as {
  document: { findUnique: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
};
const mockedIngest = vi.mocked(ingestUrl);
const mockedSync = vi.mocked(syncAllDocuments);
const mockedInvalidate = vi.mocked(semanticCache.invalidateForDocument);
const mockedAssertSafeUrl = vi.mocked(assertSafeUrl);

function makeCaller(role: "USER" | "ADMIN" = "ADMIN") {
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

describe("document router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAssertSafeUrl.mockResolvedValue();
  });

  it("requires the ADMIN role", async () => {
    const caller = makeCaller("USER");
    await expect(caller.document.delete({ id: "d1" })).rejects.toThrow();
    await expect(caller.document.ingestUrl({ url: "https://example.com" })).rejects.toThrow();
  });

  it("delete: removes a document and invalidates cache + corpus", async () => {
    prismaMock.document.findUnique.mockResolvedValue({
      id: "d1",
      title: "Blocked Account",
      chunkCount: 8,
    } as never);
    prismaMock.document.delete.mockResolvedValue({} as never);
    mockedInvalidate.mockResolvedValue(4);

    const caller = makeCaller();
    const result = await caller.document.delete({ id: "d1" });
    expect(result.deletedChunks).toBe(8);
    expect(result.cacheInvalidated).toBe(4);
    expect(mockedInvalidate).toHaveBeenCalledWith("d1");
  });

  it("delete: throws NotFoundError for missing documents", async () => {
    prismaMock.document.findUnique.mockResolvedValue(null);
    const caller = makeCaller();
    await expect(caller.document.delete({ id: "missing" })).rejects.toThrow();
  });

  it("ingestUrl: SSRF-validates then ingests the URL", async () => {
    mockedIngest.mockResolvedValue({
      url: "https://example.com/visa",
      title: "Visa Guide",
      status: "created",
      chunkCount: 12,
      hash: "h",
      cacheInvalidated: 0,
    });
    const caller = makeCaller();
    const result = await caller.document.ingestUrl({ url: "https://example.com/visa" });
    expect(mockedAssertSafeUrl).toHaveBeenCalledWith("https://example.com/visa");
    expect(result.status).toBe("created");
    expect(result.chunkCount).toBe(12);
    expect(mockedIngest).toHaveBeenCalledWith("https://example.com/visa", { title: undefined });
  });

  it("ingestUrl: forwards an optional title override to the pipeline", async () => {
    mockedIngest.mockResolvedValue({
      url: "https://example.com/visa",
      title: "Visa Guide Custom",
      status: "created",
      chunkCount: 12,
      hash: "h",
      cacheInvalidated: 0,
    });
    const caller = makeCaller();
    await caller.document.ingestUrl({ url: "https://example.com/visa", title: "Visa Guide Custom" });
    expect(mockedIngest).toHaveBeenCalledWith("https://example.com/visa", {
      title: "Visa Guide Custom",
    });
  });

  it("ingestUrl: propagates SSRF blocks", async () => {
    mockedAssertSafeUrl.mockRejectedValue(new Error("SSRF blocked"));
    const caller = makeCaller();
    await expect(
      caller.document.ingestUrl({ url: "http://127.0.0.1/x" }),
    ).rejects.toThrow("SSRF blocked");
    expect(mockedIngest).not.toHaveBeenCalled();
  });

  it("sync: re-ingests all documents and reports failures", async () => {
    mockedSync.mockResolvedValue([
      {
        url: "https://example.com/a",
        title: "A",
        status: "skipped",
        chunkCount: 3,
        hash: "h",
        cacheInvalidated: 0,
      },
      {
        url: "https://example.com/b",
        title: "B",
        status: "failed",
        chunkCount: 0,
        hash: "h",
        cacheInvalidated: 0,
        error: "fetch failed",
      },
    ]);
    const caller = makeCaller();
    const result = await caller.document.sync({ force: false });
    expect(result.failed).toBe(1);
    expect(result.results).toHaveLength(2);
  });
});
