import type { Chunk } from "@/server/rag/types";
import type { CorpusProvider } from "@/server/rag/retrieval/hybrid";
import { prisma } from "@/server/db";

/**
 * Loads the full chunk corpus from pgvector-backed Postgres.
 * BM25 is stateless and rebuilt per request over this corpus
 * (WEB_APP_PLAN §7: fast for <1000 chunks).
 */
export class PrismaCorpusProvider implements CorpusProvider {
  private cache: Chunk[] | null = null;
  private cacheTime = 0;
  private static readonly CACHE_TTL_MS = 60_000;

  async loadChunks(): Promise<Chunk[]> {
    const now = Date.now();
    if (this.cache && now - this.cacheTime < PrismaCorpusProvider.CACHE_TTL_MS) {
      return this.cache;
    }

    const rows = await prisma.documentChunk.findMany({
      select: { id: true, documentId: true, sourceName: true, sourceUrl: true, text: true },
      orderBy: { id: "asc" },
    });

    this.cache = rows.map((row) => ({
      id: String(row.id),
      documentId: row.documentId,
      sourceName: row.sourceName,
      sourceUrl: row.sourceUrl,
      text: row.text,
    }));
    this.cacheTime = now;
    return this.cache;
  }

  async invalidate(): Promise<void> {
    this.cache = null;
    this.cacheTime = 0;
  }
}
