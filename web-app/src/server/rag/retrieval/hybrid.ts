import type { Chunk, HybridRetrievalResultWithTelemetry } from "@/server/rag/types";
import {
  CRAG_THRESHOLD,
  DEFAULT_MIN_SIMILARITY,
  DENSE_TOP_K,
  QUERY_EMBEDDING_PREFIX,
  RERANK_TOP_K,
  RRF_K,
  SPARSE_TOP_K,
} from "@/server/rag/types";
import { denseRetrieve } from "@/server/rag/retrieval/dense";
import { reciprocalRankFusion } from "@/server/rag/retrieval/rrf";
import { expandToParents } from "@/server/rag/retrieval/join";
import { SparseRetriever } from "@/server/rag/retrieval/sparse";
import type { CorpusProvider } from "@/server/rag/retrieval/sparse";
import type { Reranker } from "@/server/rag/retrieval/reranker";
import type { EmbeddingClient } from "@/server/embeddings/client";
import { prisma } from "@/server/db";
import { createLogger } from "@/server/lib/logger";

const logger = createLogger("hybrid-retrieval");

export interface HybridRetrieverOptions {
  embeddingClient: EmbeddingClient;
  reranker: Reranker;
  corpusProvider: CorpusProvider;
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

  async retrieve(
    query: string,
    queries: string[],
    queryExpansionDurationMs: number = 0,
  ): Promise<HybridRetrievalResultWithTelemetry> {
    // Sparse search runs in Postgres (tsvector + GIN) so the full corpus is
    // never transferred on the hot path. The corpus is only loaded (and BM25
    // built) if the FTS query is unavailable — e.g. a fresh DB missing the
    // index — keeping in-process BM25 as a pure fallback. The dispatch +
    // fallback + BM25 memoization live in SparseRetriever so the contract is
    // unit-testable in isolation.
    const sparseRetriever = new SparseRetriever(prisma, this.options.corpusProvider);

    const denseRankings: Chunk[][] = [];
    const sparseRankings: Chunk[][] = [];

    const t0_dense = performance.now();
    const queryVectors = await this.options.embeddingClient.embedTexts(
      queries.map((subQuery) => `${QUERY_EMBEDDING_PREFIX}${subQuery.trim()}`),
    );
    const perQueryDense = await Promise.all(
      queries.map(async (subQuery, index) => {
        return await denseRetrieve(queryVectors[index], {
          topK: DENSE_TOP_K,
          minSimilarity: DEFAULT_MIN_SIMILARITY,
        });
      }),
    );
    const denseDurationMs = performance.now() - t0_dense;

    const t0_sparse = performance.now();
    const perQuerySparse = await Promise.all(
      queries.map((subQuery) => sparseRetriever.search(subQuery, SPARSE_TOP_K)),
    );
    const sparseBm25DurationMs = performance.now() - t0_sparse;
    const { engine: sparseEngine, corpusLoadDurationMs } = perQuerySparse[0];

    for (let i = 0; i < queries.length; i++) {
      denseRankings.push(perQueryDense[i]);
      sparseRankings.push(perQuerySparse[i].chunks);
    }

    const allRankings = [...denseRankings, ...sparseRankings];
    const t0_rrf = performance.now();
    const fused = reciprocalRankFusion(allRankings, RRF_K);
    const rrfFusionDurationMs = performance.now() - t0_rrf;
    logger.info(`[HYBRID] RRF fusion produced ${fused.length} unique chunks`);

    const t0_rerank = performance.now();
    const reranked = await this.options.reranker.rerank(query, fused, RERANK_TOP_K);
    const rerankDurationMs = performance.now() - t0_rerank;

    const bestCrossScore = reranked[0]?.crossScore ?? 0;
    const needsWebFallback = bestCrossScore < CRAG_THRESHOLD;
    const pathUsed = needsWebFallback
      ? "CRAG_CONFIDENCE_GATE_WEB_FALLBACK"
      : "HYBRID_RRF_CROSS_ENCODER";

    // True Parent-Child join: expand matched child chunks to their parent
    // context so the LLM receives ~2000-char sections, not 200-char snippets.
    const chunks = await expandToParents(reranked);

    logger.info(
      `[HYBRID] best cross score ${bestCrossScore.toFixed(4)} (threshold ${CRAG_THRESHOLD}) → ${pathUsed}`,
    );

    return {
      chunks,
      bestCrossScore,
      needsWebFallback,
      pathUsed,
      telemetry: {
        queryExpansionDurationMs,
        expandedQueries: queries,
        denseDurationMs,
        sparseBm25DurationMs,
        rrfFusionDurationMs,
        rerankDurationMs,
        bestCrossScore,
        cragFallbackTriggered: needsWebFallback,
        corpusLoadDurationMs,
        sparseEngine,
      },
    };
  }
}
