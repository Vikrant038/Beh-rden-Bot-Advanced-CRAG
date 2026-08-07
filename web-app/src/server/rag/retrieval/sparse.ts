import type { PrismaClient } from "@prisma/client";
import type { Chunk } from "@/server/rag/types";
import { SPARSE_TOP_K } from "@/server/rag/types";
import { buildBm25, type Bm25Search } from "@/server/rag/retrieval/bm25";
import { vectorQueries } from "@/server/db/vector-queries";
import { createLogger } from "@/server/lib/logger";

const logger = createLogger("sparse-retrieval");

/**
 * In-process BM25 index is memoized per corpus instance — only used on the
 * FTS fallback path (sparse search normally runs inside Postgres, see
 * vectorQueries.sparseSearch). The corpus provider caches its array for 1h and
 * returns the same reference, so the index survives across requests without
 * rebuilds.
 */
const bm25IndexCache = new WeakMap<Chunk[], Bm25Search>();

export interface SparseSearchOutcome {
  chunks: Chunk[];
  engine: "pg_fts" | "bm25_inproc";
  corpusLoadDurationMs: number;
}

/** Loads the full chunk corpus (used only on the BM25 fallback path). */
export interface CorpusProvider {
  loadChunks(): Promise<Chunk[]>;
}

/**
 * Sparse retrieval dispatcher.
 *
 * Prefers Postgres FTS (tsvector + GIN) so the full corpus is never transferred
 * on the hot path. If the FTS query is unavailable — e.g. a fresh DB missing the
 * index — the corpus is loaded once and scored in-process with a memoized BM25
 * index (see `bm25IndexCache`), keeping BM25 as a pure fallback.
 *
 * Splitting this out of the hybrid retriever makes the fallback contract
 * (see vectorQueries.sparseSearch) directly unit-testable without driving the
 * full retrieval pipeline or racing the WeakMap cache.
 */
export class SparseRetriever {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly corpusProvider: CorpusProvider,
  ) {}

  /**
   * Runs sparse retrieval for one query, transparently falling back to
   * in-process BM25 when Postgres FTS is unavailable. Returns the matched
   * chunks plus the engine + corpus-load telemetry the hybrid retriever reports.
   */
  async search(query: string, topK: number = SPARSE_TOP_K): Promise<SparseSearchOutcome> {
    try {
      const chunks = await vectorQueries.sparseSearch(this.prisma, query, { topK });
      return { chunks, engine: "pg_fts", corpusLoadDurationMs: 0 };
    } catch (error) {
      logger.warn(
        { error: String(error) },
        "[SPARSE] Postgres FTS sparse search failed; falling back to in-process BM25",
      );
      return this.searchBm25(query, topK);
    }
  }

  private async searchBm25(
    query: string,
    topK: number,
  ): Promise<SparseSearchOutcome> {
    const t0_corpus = performance.now();
    const corpus = await this.corpusProvider.loadChunks();
    const corpusLoadDurationMs = performance.now() - t0_corpus;

    let bm25 = bm25IndexCache.get(corpus);
    if (!bm25) {
      bm25 = buildBm25(corpus);
      bm25IndexCache.set(corpus, bm25);
    }
    return { chunks: bm25.search(query, topK), engine: "bm25_inproc", corpusLoadDurationMs };
  }
}