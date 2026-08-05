import type { Chunk } from "@/server/rag/types";
import { RRF_K } from "@/server/rag/types";

export function chunkIdentity(chunk: Chunk): string {
  return `${chunk.sourceName}::${chunk.id}::${chunk.text.length}`;
}

/**
 * Reciprocal Rank Fusion (RRF).
 * Score = sum over each ranking list of 1 / (k + rank).
 * Ported from `src/advanced_retrieval.py:reciprocal_rank_fusion` with k=60.
 */
export function reciprocalRankFusion(rankings: Chunk[][], k: number = RRF_K): Chunk[] {
  const chunkMap = new Map<string, Chunk>();
  const rrfScores = new Map<string, number>();

  for (const rankList of rankings) {
    for (const [index, chunk] of rankList.entries()) {
      const id = chunkIdentity(chunk);
      chunkMap.set(id, chunk);
      rrfScores.set(id, (rrfScores.get(id) ?? 0) + 1 / (k + index + 1));
    }
  }

  const sorted = [...rrfScores.entries()].sort((a, b) => b[1] - a[1]);

  return sorted.map(([id, score]) => ({
    ...chunkMap.get(id)!,
    rrfScore: score,
  }));
}
