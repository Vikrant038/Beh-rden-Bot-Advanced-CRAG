import { reciprocalRankFusion } from "@/server/rag/retrieval/rrf";
import type { Chunk } from "@/server/rag/types";

function makeChunk(id: string, sourceName = "doc"): Chunk {
  return { id, sourceName, sourceUrl: `https://example.com/${sourceName}`, text: `text-${id}` };
}

describe("RRFFusion", () => {
  it("should fuse dense + sparse rankings with k=60", () => {
    const dense: Chunk[] = [makeChunk("a"), makeChunk("b"), makeChunk("c")];
    const sparse: Chunk[] = [makeChunk("c"), makeChunk("b")];

    const fused = reciprocalRankFusion([dense, sparse], 60);

    expect(fused[0].id).toBe("c");
    expect(fused[1].id).toBe("b");
    expect(fused[2].id).toBe("a");
  });

  it("should rank items present in both lists higher", () => {
    const dense: Chunk[] = [makeChunk("x"), makeChunk("y")];
    const sparse: Chunk[] = [makeChunk("y"), makeChunk("x"), makeChunk("z")];

    const fused = reciprocalRankFusion([dense, sparse], 60);

    expect(fused[0].id).toBe("x");
    expect(fused[1].id).toBe("y");
    expect(fused[2].id).toBe("z");
  });

  it("should handle empty ranking lists", () => {
    const fused = reciprocalRankFusion([[], []]);
    expect(fused).toEqual([]);
  });

  it("should be deterministic for identical inputs", () => {
    const rankings: Chunk[][] = [
      [makeChunk("a"), makeChunk("b")],
      [makeChunk("b"), makeChunk("a")],
    ];
    expect(reciprocalRankFusion(rankings, 60)).toEqual(reciprocalRankFusion(rankings, 60));
  });

  it("should set rrfScore on fused chunks", () => {
    const fused = reciprocalRankFusion([[makeChunk("a")]], 60);
    expect(fused[0].rrfScore).toBeCloseTo(1 / 61, 10);
  });
});
