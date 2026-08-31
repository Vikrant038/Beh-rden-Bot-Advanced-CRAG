import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@/server/db", () => ({
  prisma: {
    document: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    documentChunk: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from "@/server/db";
import type { MockPrisma } from "../helpers/mock-prisma";
import { makeUserCaller } from "../helpers/caller";

const prismaMock = prisma as unknown as MockPrisma;

const makeCaller = () => makeUserCaller(prismaMock);

describe("source router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("list: returns indexed documents with chunk counts", async () => {
    prismaMock.document.findMany.mockResolvedValue([
      {
        id: "d1",
        title: "Blocked Account",
        url: "https://example.com",
        chunkCount: 12,
        updatedAt: new Date(),
        createdAt: new Date(),
      },
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
      {
        id: 1,
        sourceName: "doc",
        sourceUrl: "https://example.com",
        text: "chunk one",
        createdAt: new Date(),
      },
      {
        id: 2,
        sourceName: "doc",
        sourceUrl: "https://example.com",
        text: "chunk two",
        createdAt: new Date(),
      },
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

  it("getChunks: honours a cursor (offset pagination)", async () => {
    prismaMock.document.findUnique.mockResolvedValue({ id: "d1" } as never);
    prismaMock.documentChunk.findMany.mockResolvedValue([
      {
        id: 5,
        sourceName: "doc",
        sourceUrl: "https://example.com",
        text: "chunk five",
        createdAt: new Date(),
      },
    ] as never);

    const caller = makeCaller();
    const result = await caller.source.getChunks({ documentId: "d1", limit: 10, cursor: 4 });
    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
    expect(prismaMock.documentChunk.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { id: 4 }, skip: 1 }),
    );
  });

  it("stats: aggregates source counts by ingest status", async () => {
    prismaMock.document.count.mockResolvedValue(5);
    prismaMock.documentChunk.count.mockResolvedValue(120);
    prismaMock.document.groupBy.mockResolvedValue([
      { status: "SYNCED", _count: { _all: 3 } },
      { status: "FAILED", _count: { _all: 1 } },
      { status: "PENDING", _count: { _all: 1 } },
    ] as never);

    const caller = makeCaller();
    await expect(caller.source.stats()).resolves.toEqual({
      totalSources: 5,
      totalChunks: 120,
      syncedSources: 3,
      failedSources: 1,
      pendingSources: 1,
    });
  });

  it("stats: defaults to zero when a status group is absent", async () => {
    prismaMock.document.count.mockResolvedValue(0);
    prismaMock.documentChunk.count.mockResolvedValue(0);
    prismaMock.document.groupBy.mockResolvedValue([] as never);

    const caller = makeCaller();
    await expect(caller.source.stats()).resolves.toEqual({
      totalSources: 0,
      totalChunks: 0,
      syncedSources: 0,
      failedSources: 0,
      pendingSources: 0,
    });
  });

  it("searchChunks: returns text matches case-insensitively", async () => {
    prismaMock.documentChunk.findMany.mockResolvedValue([
      {
        id: 9,
        sourceName: "doc",
        sourceUrl: "https://example.com",
        text: "APS certificate",
        createdAt: new Date(),
      },
    ] as never);

    const caller = makeCaller();
    const result = await caller.source.searchChunks({ query: "aps" });
    expect(result.items).toHaveLength(1);
    expect(prismaMock.documentChunk.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 20 }),
    );
  });
});
