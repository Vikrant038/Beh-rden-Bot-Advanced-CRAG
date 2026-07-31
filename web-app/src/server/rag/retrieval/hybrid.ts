import type { Chunk } from "@/server/rag/types";
import {
  CRAG_THRESHOLD,
  DEFAULT_MIN_SIMILARITY,
  DENSE_TOP_K,
  RERANK_TOP_K,
  RRF_K,
  SPARSE_TOP_K,
} from "@/server/rag/types";
import { denseRetrieve } from "@/server/rag/retrieval/dense";
import { buildBm25 } from "@/server/rag/retrieval/bm25";
import { reciprocalRankFusion } from "@/server/rag/retrieval/rrf";
import type { Reranker } from "@/server/rag/retrieval/reranker";
import type { EmbeddingClient } from "@/server/embeddings/client";
import { createLogger } from "@/server/lib/logger";

const logger = createLogger("hybrid-retrieval");

export interface CorpusProvider {
  loadChunks(): Promise<Chunk[]>;
}

export interface HybridRetrieverOptions {
  embeddingClient: EmbeddingClient;
  reranker: Reranker;
  corpusProvider: CorpusProvider;
}

export interface HybridRetrievalResult {
  chunks: Chunk[];
  bestCrossScore: number;
  needsWebFallback: boolean;
  pathUsed: string;
}

/**
 * Hybrid retriever: dense (pgvector) + sparse (BM25) → RRF fusion →
 * cross-encoder rerank → CRAG confidence gate.
 * Ported from `src/advanced_retrieval.py:advanced_crag_retrieve`.
 */
export class HybridRetriever {
  constructor(private readonly options: HybridRetrieverOptions) {}

  async embedQuery(query: string): Promise<number[]> {
    return this.options.embeddingClient.embedQuery(query);
  }

  async retrieve(query: string, queries: string[]): Promise<HybridRetrievalResult> {
    const corpus = await this.options.corpusProvider.loadChunks();
    const bm25 = buildBm25(corpus);

    const denseRankings: Chunk[][] = [];
    const sparseRankings: Chunk[][] = [];

    for (const subQuery of queries) {
      const queryVector = await this.options.embeddingClient.embedQuery(subQuery);

      const denseResults = await denseRetrieve(queryVector, {
        topK: DENSE_TOP_K,
        minSimilarity: DEFAULT_MIN_SIMILARITY,
      });
      denseRankings.push(denseResults);

      const sparseResults = bm25.search(subQuery, SPARSE_TOP_K);
      sparseRankings.push(sparseResults);
    }

    const allRankings = [...denseRankings, ...sparseRankings];
    const fused = reciprocalRankFusion(allRankings, RRF_K);
    logger.info(`[HYBRID] RRF fusion produced ${fused.length} unique chunks`);

    const reranked = await this.options.reranker.rerank(query, fused, RERANK_TOP_K);

    const bestCrossScore = reranked[0]?.crossScore ?? 0;
    const needsWebFallback = bestCrossScore < CRAG_THRESHOLD;
    const pathUsed = needsWebFallback
      ? "CRAG_CONFIDENCE_GATE_WEB_FALLBACK"
      : "HYBRID_RRF_CROSS_ENCODER";

    logger.info(
      `[HYBRID] best cross score ${bestCrossScore.toFixed(4)} (threshold ${CRAG_THRESHOLD}) → ${pathUsed}`,
    );

    return {
      chunks: reranked,
      bestCrossScore,
      needsWebFallback,
      pathUsed,
    };
  }
}
