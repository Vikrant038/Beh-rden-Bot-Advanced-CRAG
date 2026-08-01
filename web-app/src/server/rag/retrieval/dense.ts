import type { Chunk } from "@/server/rag/types";
import { DEFAULT_MIN_SIMILARITY, DENSE_TOP_K } from "@/server/rag/types";
import { prisma } from "@/server/db";
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
 */
export async function denseRetrieve(
  queryVector: number[],
  options: DenseRetrievalOptions = {},
): Promise<Chunk[]> {
  const topK = options.topK ?? DENSE_TOP_K;
  const minSimilarity = options.minSimilarity ?? DEFAULT_MIN_SIMILARITY;

  const vectorLiteral = `[${queryVector.join(",")}]`;

  try {
    const rows = await prisma.$queryRaw<
      Array<{
        id: number;
        parentId: number | null;
        sourceName: string;
        sourceUrl: string;
        text: string;
        sim: number;
      }>
    >`
      SELECT id, "parentId", "sourceName", "sourceUrl", text, 1 - (embedding <=> ${vectorLiteral}::vector) AS sim
      FROM document_chunks
      WHERE 1 - (embedding <=> ${vectorLiteral}::vector) >= ${minSimilarity}
      ORDER BY embedding <=> ${vectorLiteral}::vector
      LIMIT ${topK};
    `;

    return rows.map((row) => ({
      id: String(row.id),
      documentId: undefined,
      parentId: row.parentId === null ? undefined : String(row.parentId),
      sourceName: row.sourceName,
      sourceUrl: row.sourceUrl,
      text: row.text,
      similarityScore: Number(row.sim),
    }));
  } catch (error) {
    logger.warn({ error: String(error) }, "[DENSE] pgvector query failed");
    throw new DomainError("Dense retrieval query failed", ErrorCode.RETRIEVAL_ERROR, error);
  }
}
