import type { Chunk } from "@/server/rag/types";
import { DEFAULT_MIN_SIMILARITY, DENSE_TOP_K } from "@/server/rag/types";
import { prisma } from "@/server/db";
import { vectorQueries } from "@/server/db/vector-queries";
import { createLogger } from "@/server/lib/logger";
import { DomainError, ErrorCode } from "@/server/lib/errors";

const logger = createLogger("dense-retrieval");

export interface DenseRetrievalOptions {
  topK?: number;
  minSimilarity?: number;
}

/**
 * pgvector dense retrieval via cosine similarity (`<=>` distance).
 * Ported from `src/retrieval.py:retrieve` — min similarity 0.20, normalized
 * vectors, BGE query-prefix applied by the embedding client.
 *
 * Raw SQL is delegated to `vectorQueries.findSimilarChunks` — the single
 * source of truth for all pgvector read queries (see src/server/db/vector-queries.ts).
 */
export async function denseRetrieve(
  queryVector: number[],
  options: DenseRetrievalOptions = {},
): Promise<Chunk[]> {
  const topK = options.topK ?? DENSE_TOP_K;
  const minSimilarity = options.minSimilarity ?? DEFAULT_MIN_SIMILARITY;

  try {
    return await vectorQueries.findSimilarChunks(prisma, queryVector, { topK, minSimilarity });
  } catch (error) {
    logger.warn({ error: String(error) }, "[DENSE] pgvector query failed");
    throw new DomainError("Dense retrieval query failed", ErrorCode.RETRIEVAL_ERROR, error);
  }
}
