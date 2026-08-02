/**
 * Central vector query helpers for pgvector operations.
 *
 * Why this exists: Prisma does not natively support the `vector` column type,
 * so every vector read/write requires raw SQL via `$queryRaw` / `$executeRaw`.
 * Scattering those raw strings across dense.ts, semantic-cache.ts, and
 * ingest/pipeline.ts makes the SQL hard to audit and creates formatting
 * inconsistencies (e.g. different vector literal shapes). This module is the
 * single source of truth for all pgvector raw queries.
 *
 * Usage:
 *   import { vectorQueries } from "@/server/db/vector-queries";
 *   const rows = await vectorQueries.findSimilarChunks(prisma, queryVector, { topK: 15 });
 */

import type { PrismaClient } from "@prisma/client";
import type { Chunk } from "@/server/rag/types";
import { DEFAULT_MIN_SIMILARITY, DENSE_TOP_K } from "@/server/rag/types";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SimilarChunkRow {
  id: number;
  parentId: number | null;
  documentId: string | null;
  sourceName: string;
  sourceUrl: string;
  text: string;
  sim: number;
}

export interface CacheSimRow {
  responseJson: unknown;
  sim: number;
}

export interface FindSimilarChunksOptions {
  topK?: number;
  minSimilarity?: number;
}

export interface UpsertCacheEntryParams {
  queryHash: string;
  queryText: string;
  queryVector: number[];
  responseJson: string;
  parentDocIds: string[];
  now: Date;
  expiresAt: Date;
}

// ─── Helper ─────────────────────────────────────────────────────────────────

/**
 * Formats a float array as a pgvector literal: `[0.1,0.2,…]`.
 * Exported so callers can log or test the literal shape without re-implementing it.
 */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

// ─── Query functions ─────────────────────────────────────────────────────────

/**
 * Finds the top-K most similar document chunks to `queryVector` using cosine
 * distance (`<=>`) in pgvector. Excludes rows below `minSimilarity`.
 */
async function findSimilarChunks(
  prisma: PrismaClient,
  queryVector: number[],
  options: FindSimilarChunksOptions = {},
): Promise<Chunk[]> {
  const topK = options.topK ?? DENSE_TOP_K;
  const minSimilarity = options.minSimilarity ?? DEFAULT_MIN_SIMILARITY;
  const literal = toVectorLiteral(queryVector);

  const rows = await prisma.$queryRaw<SimilarChunkRow[]>`
    SELECT
      id,
      "parentId",
      "documentId",
      "sourceName",
      "sourceUrl",
      text,
      1 - (embedding <=> ${literal}::vector) AS sim
    FROM document_chunks
    WHERE 1 - (embedding <=> ${literal}::vector) >= ${minSimilarity}
    ORDER BY embedding <=> ${literal}::vector
    LIMIT ${topK};
  `;

  return rows.map((row) => ({
    id: String(row.id),
    parentId: row.parentId === null ? undefined : String(row.parentId),
    documentId: row.documentId ?? undefined,
    sourceName: row.sourceName,
    sourceUrl: row.sourceUrl,
    text: row.text,
    similarityScore: Number(row.sim),
  }));
}

/**
 * Finds the single most similar semantic-cache entry to `queryVector` that
 * has not yet expired, returning its `responseJson` and cosine similarity.
 * Returns an empty array when no entries exist.
 */
async function findSimilarCacheEntry(
  prisma: PrismaClient,
  queryVector: number[],
  now: Date,
): Promise<CacheSimRow[]> {
  const literal = toVectorLiteral(queryVector);

  return prisma.$queryRaw<CacheSimRow[]>`
    SELECT "responseJson", 1 - ("queryVector" <=> ${literal}::vector) AS sim
    FROM semantic_cache
    WHERE "expiresAt" > ${now}
    ORDER BY "queryVector" <=> ${literal}::vector
    LIMIT 1;
  `;
}

/**
 * Atomically upserts a semantic-cache entry. Uses ON CONFLICT DO UPDATE so
 * concurrent writes for the same `queryHash` do not crash on the unique
 * constraint (last writer wins).
 */
async function upsertCacheEntry(
  prisma: PrismaClient,
  params: UpsertCacheEntryParams,
): Promise<void> {
  const literal = toVectorLiteral(params.queryVector);

  await prisma.$executeRaw`
    INSERT INTO semantic_cache
      (id, "queryHash", "queryText", "queryVector", "responseJson", "parentDocIds", "createdAt", "expiresAt")
    VALUES (
      nextval(pg_get_serial_sequence('semantic_cache', 'id')),
      ${params.queryHash},
      ${params.queryText},
      ${literal}::vector,
      ${params.responseJson}::jsonb,
      ${params.parentDocIds},
      ${params.now},
      ${params.expiresAt}
    )
    ON CONFLICT ("queryHash") DO UPDATE
      SET "responseJson" = EXCLUDED."responseJson",
          "expiresAt"    = EXCLUDED."expiresAt";
  `;
}

// ─── Exported namespace ───────────────────────────────────────────────────────

export const vectorQueries = {
  findSimilarChunks,
  findSimilarCacheEntry,
  upsertCacheEntry,
} as const;
