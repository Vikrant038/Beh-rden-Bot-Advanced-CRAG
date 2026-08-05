import { vi, describe, it, expect, beforeEach } from "vitest";
import { denseRetrieve } from "@/server/rag/retrieval/dense";

vi.mock("@/server/db", async () => {
  const prisma = {
    $queryRaw: vi.fn(),
  };
  return { prisma };
});

import { prisma } from "@/server/db";

const mockedQueryRaw = vi.mocked(prisma.$queryRaw);

describe("denseRetrieve (pgvector)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return mapped chunks with similarity scores", async () => {
    mockedQueryRaw.mockResolvedValue([
      { id: 1, sourceName: "doc-a", sourceUrl: "https://a.example", text: "text", sim: 0.9 },
      { id: 2, sourceName: "doc-b", sourceUrl: "https://b.example", text: "more", sim: 0.75 },
    ] as never);

    const result = await denseRetrieve(Array.from({ length: 1024 }, () => 0.1));
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: "1",
      sourceName: "doc-a",
      sourceUrl: "https://a.example",
      text: "text",
      similarityScore: 0.9,
    });
    expect(result[1].similarityScore).toBe(0.75);
  });

  it("should pass topK and minSimilarity options", async () => {
    mockedQueryRaw.mockResolvedValue([]);
    await denseRetrieve(
      Array.from({ length: 1024 }, () => 0.1),
      { topK: 7, minSimilarity: 0.4 },
    );

    const args = mockedQueryRaw.mock.calls[0] as unknown as unknown[];
    expect(args).toContain(7);
    expect(args).toContain(0.4);
  });

  it("should throw DomainError when query fails", async () => {
    mockedQueryRaw.mockRejectedValue(new Error("pgvector down"));
    await expect(denseRetrieve(Array.from({ length: 1024 }, () => 0.1))).rejects.toThrow(
      /Dense retrieval query failed/,
    );
  });
});
