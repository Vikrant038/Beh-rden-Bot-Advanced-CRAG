import type { Chunk } from "@/server/rag/types";
import type { CorpusProvider } from "@/server/rag/retrieval/hybrid";
import { prisma } from "@/server/db";

/**
 * Loads the full chunk corpus from pgvector-backed Postgres.
 *
 * This is the BM25 fallback path only: sparse retrieval normally runs inside
 * Postgres (tsvector + GIN, see vectorQueries.sparseSearch) so the 3.5MB corpus
 * is never transferred per request. When FTS is unavailable the corpus is
 * loaded once and cached for a long TTL — the corpus changes ONLY on ingest,
 * and the ingest pipeline calls invalidate() explicitly (pipeline.ts), so the
 * long TTL cannot serve stale chunks.
 */
export class PrismaCorpusProvider implements CorpusProvider {
  private cache: Chunk[] | null = null;
  private cacheTime = 0;
  // 1h: the corpus is immutable between ingests, and ingest invalidates. A long
  // TTL keeps the same array reference alive so the hybrid retriever's WeakMap
  // BM25 index survives across requests instead of being rebuilt every 60s.
  private static readonly CACHE_TTL_MS = 3_600_000;

  async loadChunks(): Promise<Chunk[]> {
    const now = Date.now();
    if (this.cache && now - this.cacheTime < PrismaCorpusProvider.CACHE_TTL_MS) {
      return this.cache;
    }

    const chunks: Chunk[] = [];
    let cursor: number | undefined;
    // 5000/batch: 5 round-trips for the full 23.9k corpus instead of 25.
    const batchSize = 5000;

    while (true) {
      const rows = await prisma.documentChunk.findMany({
        take: batchSize,
        skip: cursor !== undefined ? 1 : 0,
        cursor: cursor !== undefined ? { id: cursor } : undefined,
        select: {
          id: true,
          parentId: true,
          documentId: true,
          sourceName: true,
          sourceUrl: true,
          text: true,
        },
        orderBy: { id: "asc" },
      });

      if (rows.length === 0) {
        break;
      }

      for (const row of rows) {
        chunks.push({
          id: String(row.id),
          parentId: row.parentId === null ? undefined : String(row.parentId),
          documentId: row.documentId,
          sourceName: row.sourceName,
          sourceUrl: row.sourceUrl,
          text: row.text,
        });
      }

      cursor = rows[rows.length - 1].id;
    }

    this.cache = chunks;
    this.cacheTime = now;
    return this.cache;
  }

  async invalidate(): Promise<void> {
    this.cache = null;
    this.cacheTime = 0;
  }
}
