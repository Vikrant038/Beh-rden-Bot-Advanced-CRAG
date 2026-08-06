import { vi, describe, it, expect, beforeEach } from "vitest";
import { vectorQueries, toVectorLiteral, type SparseSearchRow } from "@/server/db/vector-queries";

vi.mock("@/server/db", () => ({ prisma: {} }));

function makePrisma() {
  const prisma = { $queryRaw: vi.fn(), $executeRaw: vi.fn() };
  return prisma;
}

describe("toVectorLiteral", () => {
  it("formats a valid vector as a pgvector literal", () => {
    const vector = Array.from({ length: 1024 }, (_v, i) => (i === 0 ? 0.1 : 0.2));
    expect(toVectorLiteral(vector)).toBe(`[${vector.join(",")}]`);
  });

  it("throws for a non-array value", () => {
    expect(() => toVectorLiteral(null as never)).toThrow(/not an array/);
    expect(() => toVectorLiteral([])).toThrow(/empty/);
  });

  it("throws for the wrong dimension", () => {
    expect(() => toVectorLiteral([0.1, 0.2])).toThrow(/Invalid vector dimension/);
  });

  it("throws for a non-finite element", () => {
    const bad = Array.from({ length: 1024 }, () => 0.1) as number[];
    bad[5] = Number.NaN;
    expect(() => toVectorLiteral(bad)).toThrow(/not a finite number/);
  });
});

describe("vectorQueries.findSimilarChunks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps rows with parentId and documentId present", async () => {
    const prisma = makePrisma();
    prisma.$queryRaw.mockResolvedValue([
      {
        id: 7,
        parentId: 3,
        documentId: "doc-1",
        sourceName: "Doc",
        sourceUrl: "https://a",
        text: "body",
        sim: 0.91,
      },
    ]);
    const result = await vectorQueries.findSimilarChunks(
      prisma as never,
      Array.from({ length: 1024 }, () => 0.5),
      { topK: 5, minSimilarity: 0.4 },
    );
    expect(result[0]).toMatchObject({
      id: "7",
      parentId: "3",
      documentId: "doc-1",
      similarityScore: 0.91,
    });
  });

  it("maps rows with null parentId/documentId to undefined", async () => {
    const prisma = makePrisma();
    prisma.$queryRaw.mockResolvedValue([
      {
        id: 9,
        parentId: null,
        documentId: null,
        sourceName: "S",
        sourceUrl: "u",
        text: "t",
        sim: 0.5,
      },
    ]);
    const result = await vectorQueries.findSimilarChunks(
      prisma as never,
      Array.from({ length: 1024 }, () => 0.5),
    );
    expect(result[0]).toMatchObject({ parentId: undefined, documentId: undefined });
  });
});

describe("vectorQueries.sparseSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns [] without querying when the query is all stopwords", async () => {
    const prisma = makePrisma();
    const result = await vectorQueries.sparseSearch(prisma as never, "the and or is");
    expect(result).toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("returns [] without querying for an empty query", async () => {
    const prisma = makePrisma();
    const result = await vectorQueries.sparseSearch(prisma as never, "   ");
    expect(result).toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("maps ts_rank rows to chunks with bm25Score", async () => {
    const prisma = makePrisma();
    prisma.$queryRaw.mockResolvedValue([
      {
        id: 11,
        parentId: null,
        documentId: "doc-2",
        sourceName: "Src",
        sourceUrl: "https://b",
        text: "Aufenthalt",
        rank: 0.77,
      },
    ] satisfies SparseSearchRow[]);
    const result = await vectorQueries.sparseSearch(prisma as never, "Aufenthalt visa", {
      topK: 10,
    });
    expect(result[0]).toMatchObject({ id: "11", documentId: "doc-2", bm25Score: 0.77 });
    // The query text is lowercased and OR-joined into a tsquery.
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("passes topK through to the SQL", async () => {
    const prisma = makePrisma();
    prisma.$queryRaw.mockResolvedValue([]);
    await vectorQueries.sparseSearch(prisma as never, "visa blocked", { topK: 3 });
    const args = prisma.$queryRaw.mock.calls[0] as unknown as unknown[];
    expect(args).toContain(3);
  });
});
