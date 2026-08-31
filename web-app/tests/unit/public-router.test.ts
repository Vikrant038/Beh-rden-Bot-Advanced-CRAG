import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@/server/db", () => ({
  prisma: {
    document: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    documentChunk: {
      count: vi.fn(),
    },
    documentParentChunk: {
      count: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));

import { prisma } from "@/server/db";
import type { MockPrisma } from "../helpers/mock-prisma";
import { makeGuestCaller } from "../helpers/caller";

const prismaMock = prisma as unknown as MockPrisma & {
  documentParentChunk: { count: ReturnType<typeof vi.fn> };
};

const makeCaller = () => makeGuestCaller(prismaMock, undefined);

describe("public router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("corpusStats: aggregates live counts and computes the German percentage", async () => {
    prismaMock.document.count.mockResolvedValue(115 as never);
    prismaMock.documentChunk.count.mockResolvedValue(23_934 as never);
    prismaMock.documentParentChunk.count.mockResolvedValue(2_171 as never);
    prismaMock.$queryRaw.mockResolvedValue([
      { german: BigInt(7300), total: BigInt(23934) },
    ] as never);
    prismaMock.document.findMany.mockResolvedValue([
      { title: "Fiscal Code", chunkCount: 4_889 },
      { title: "Residence Act", chunkCount: 3_984 },
    ] as never);

    const result = await makeCaller().public.corpusStats();

    expect(result.sources).toBe(115);
    expect(result.chunks).toBe(23_934);
    expect(result.parentChunks).toBe(2_171);
    // 7300/23934 = 30.5%
    expect(result.germanChunkPercent).toBe(30.5);
    expect(result.topSources).toEqual([
      { title: "Fiscal Code", chunkCount: 4_889 },
      { title: "Residence Act", chunkCount: 3_984 },
    ]);
    expect(prismaMock.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { chunkCount: { gt: 0 } },
        orderBy: { chunkCount: "desc" },
        take: 6,
      }),
    );
  });

  it("corpusStats: reports 0% German and no top sources on an empty corpus", async () => {
    prismaMock.document.count.mockResolvedValue(0 as never);
    prismaMock.documentChunk.count.mockResolvedValue(0 as never);
    prismaMock.documentParentChunk.count.mockResolvedValue(0 as never);
    prismaMock.$queryRaw.mockResolvedValue([{ german: BigInt(0), total: BigInt(0) }] as never);
    prismaMock.document.findMany.mockResolvedValue([] as never);

    const result = await makeCaller().public.corpusStats();

    expect(result.germanChunkPercent).toBe(0);
    expect(result.topSources).toEqual([]);
  });

  it("corpusStats: tolerates a missing stats row from the raw query", async () => {
    prismaMock.document.count.mockResolvedValue(1 as never);
    prismaMock.documentChunk.count.mockResolvedValue(10 as never);
    prismaMock.documentParentChunk.count.mockResolvedValue(1 as never);
    prismaMock.$queryRaw.mockResolvedValue([] as never);
    prismaMock.document.findMany.mockResolvedValue([] as never);

    const result = await makeCaller().public.corpusStats();
    expect(result.germanChunkPercent).toBe(0);
    expect(result.chunks).toBe(10);
  });
});
