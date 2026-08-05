import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@/server/db", () => ({
  prisma: {
    documentParentChunk: {
      findMany: vi.fn(),
    },
  },
}));

import { expandToParents } from "@/server/rag/retrieval/join";
import { prisma } from "@/server/db";
import type { Chunk } from "@/server/rag/types";

const prismaMock = prisma as unknown as {
  documentParentChunk: { findMany: ReturnType<typeof vi.fn> };
};

function childChunk(overrides: Partial<Chunk> = {}): Chunk {
  return {
    id: "chunk-1",
    documentId: "doc-1",
    sourceName: "visa-guide.pdf",
    sourceUrl: "pdf://abc/visa-guide.pdf",
    text: "Matched child snippet text (~200 chars).",
    parentId: "42",
    similarityScore: 0.82,
    ...overrides,
  };
}

describe("expandToParents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the input unchanged when no chunk has a parentId", async () => {
    const flat: Chunk[] = [childChunk({ parentId: undefined })];
    const result = await expandToParents(flat);
    expect(result).toEqual(flat);
    expect(prismaMock.documentParentChunk.findMany).not.toHaveBeenCalled();
  });

  it("expands child chunks to their parent text", async () => {
    prismaMock.documentParentChunk.findMany.mockResolvedValue([
      { id: 42, text: "Parent context paragraph with full visa requirements (~2000 chars)." },
    ]);
    const result = await expandToParents([childChunk()]);
    expect(result).toHaveLength(1);
    expect(result[0]?.text).toBe(
      "Parent context paragraph with full visa requirements (~2000 chars).",
    );
    expect(result[0]?.childText).toBe("Matched child snippet text (~200 chars).");
    expect(prismaMock.documentParentChunk.findMany).toHaveBeenCalledWith({
      where: { id: { in: [42] } },
      select: { id: true, text: true },
    });
  });

  it("deduplicates children that share the same parent", async () => {
    prismaMock.documentParentChunk.findMany.mockResolvedValue([
      { id: 42, text: "Parent text for dedupe check." },
    ]);
    const result = await expandToParents([
      childChunk({ id: "a", parentId: "42", text: "snippet a" }),
      childChunk({ id: "b", parentId: "42", text: "snippet b" }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.childText).toBe("snippet a");
  });

  it("passes through a child whose parent row is missing", async () => {
    prismaMock.documentParentChunk.findMany.mockResolvedValue([]);
    const chunk = childChunk({ parentId: "999" });
    const result = await expandToParents([chunk]);
    expect(result).toEqual([chunk]);
  });

  it("merges flat chunks and expanded parents preserving order", async () => {
    prismaMock.documentParentChunk.findMany.mockResolvedValue([
      { id: 42, text: "Expanded parent text." },
    ]);
    const flat = childChunk({ id: "flat", parentId: undefined, text: "flat chunk" });
    const nested = childChunk({ id: "nested", parentId: "42", text: "nested snippet" });
    const result = await expandToParents([flat, nested]);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(flat);
    expect(result[1]?.text).toBe("Expanded parent text.");
    expect(result[1]?.childText).toBe("nested snippet");
  });
});
