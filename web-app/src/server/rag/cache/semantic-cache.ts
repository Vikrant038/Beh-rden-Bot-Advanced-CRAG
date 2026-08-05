import { createHash } from "node:crypto";
import { prisma } from "@/server/db";
import { vectorQueries } from "@/server/db/vector-queries";
import type { Source } from "@/server/rag/types";
import { CACHE_SIMILARITY_THRESHOLD, CACHE_TTL_SECONDS } from "@/server/rag/types";
import { createLogger } from "@/server/lib/logger";

const logger = createLogger("semantic-cache");

export interface CachePayload {
  answer: string;
  sources: Source[];
}

export interface CachedResponse {
  answer: string;
  sources: Source[];
  retrievalPath: string;
  latencyMs: number;
  isCached: boolean;
}

// Re-exported from vector-queries for backward compatibility with any existing
// test code that imports this type directly from semantic-cache.
export type { CacheSimRow as CacheHitRow } from "@/server/db/vector-queries";

/**
 * Multi-tier semantic cache (WEB_APP_PLAN §7; ported from `src/semantic_cache.py`):
 * - Tier 1: SHA-256 exact string match.
 * - Tier 2: pgvector cosine similarity >= 0.97.
 * TTL (7 days) is enforced at read and write time.
 * - Race-safe writes: INSERT … ON CONFLICT DO UPDATE eliminates the TOCTOU race.
 * - Raw SQL delegated to `vectorQueries` (src/server/db/vector-queries.ts) —
 *   the single source of truth for all pgvector queries.
 */
export class SemanticCache {
  constructor(
    private readonly threshold: number = CACHE_SIMILARITY_THRESHOLD,
    private readonly ttlSeconds: number = CACHE_TTL_SECONDS,
  ) {}

  private hashQuery(query: string): string {
    return createHash("sha256").update(query.trim().toLowerCase()).digest("hex");
  }

  async checkCache(query: string, queryVector: number[] | null): Promise<CachedResponse | null> {
    const qHash = this.hashQuery(query);
    const now = new Date();

    try {
      const exact = await prisma.semanticCacheEntry.findUnique({
        where: { queryHash: qHash },
      });
      if (exact && exact.expiresAt > now) {
        logger.info(`[CACHE HIT - TIER 1 EXACT] query: '${query.slice(0, 40)}'`);
        return this.toCachedResponse(exact, "TIER_1_EXACT_CACHE_HIT", 1.2);
      }

      if (queryVector && queryVector.length > 0) {
        const rows = await vectorQueries.findSimilarCacheEntry(prisma, queryVector, now);

        if (rows.length > 0) {
          const sim = Number(rows[0].sim);
          if (sim >= this.threshold) {
            logger.info(
              `[CACHE HIT - TIER 2 VECTOR] sim ${sim.toFixed(4)} for query: '${query.slice(0, 40)}'`,
            );
            return {
              answer: this.extractAnswer(rows[0].responseJson),
              sources: this.extractSources(rows[0].responseJson),
              retrievalPath: `TIER_2_VECTOR_CACHE_HIT (Sim: ${sim.toFixed(3)})`,
              latencyMs: 12,
              isCached: true,
            };
          }
        }
      }
    } catch (error) {
      logger.warn({ error: String(error) }, "[CACHE] check failed");
    }

    return null;
  }

  async addToCache(
    query: string,
    queryVector: number[],
    responseData: CachePayload,
    parentDocIds: string[] = [],
  ): Promise<void> {
    const qHash = this.hashQuery(query);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.ttlSeconds * 1000);
    const payload = JSON.parse(
      JSON.stringify({ answer: responseData.answer, sources: responseData.sources }),
    );

    try {
      /**
       * Delegates to vectorQueries.upsertCacheEntry which issues an atomic
       * INSERT … ON CONFLICT DO UPDATE — the single authoritative vector upsert
       * path (src/server/db/vector-queries.ts).
       */
      await vectorQueries.upsertCacheEntry(prisma, {
        queryHash: qHash,
        queryText: query,
        queryVector,
        responseJson: JSON.stringify(payload),
        parentDocIds,
        now,
        expiresAt,
      });
      logger.info(`[CACHE] upserted entry for query: '${query.slice(0, 40)}'`);
    } catch (error) {
      logger.warn({ error: String(error) }, "[CACHE] write failed");
    }
  }

  async clearAll(): Promise<boolean> {
    try {
      await prisma.semanticCacheEntry.deleteMany({});
      logger.info("[CACHE] cleared all entries");
      return true;
    } catch (error) {
      logger.warn({ error: String(error) }, "[CACHE] clear failed");
      return false;
    }
  }

  async invalidateForDocument(docId: string): Promise<number> {
    try {
      const entries = await prisma.semanticCacheEntry.findMany({
        where: { parentDocIds: { has: docId } },
      });
      const ids = entries.map((entry) => entry.id);
      if (ids.length > 0) {
        await prisma.semanticCacheEntry.deleteMany({ where: { id: { in: ids } } });
      }
      logger.info(`[CACHE] invalidated ${ids.length} entries for document '${docId}'`);
      return ids.length;
    } catch (error) {
      logger.warn({ error: String(error) }, "[CACHE] invalidate failed");
      return 0;
    }
  }

  private toCachedResponse(
    row: {
      responseJson: unknown;
    },
    retrievalPath: string,
    latencyMs: number,
  ): CachedResponse {
    return {
      answer: this.extractAnswer(row.responseJson),
      sources: this.extractSources(row.responseJson),
      retrievalPath,
      latencyMs,
      isCached: true,
    };
  }

  private extractAnswer(responseJson: unknown): string {
    const data = responseJson as { answer?: string };
    return data?.answer ?? "";
  }

  private extractSources(responseJson: unknown): Source[] {
    const data = responseJson as { sources?: Source[] };
    return Array.isArray(data?.sources) ? data.sources : [];
  }
}

export const semanticCache = new SemanticCache();
