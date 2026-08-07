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
import {
  DEFAULT_MIN_SIMILARITY,
  DENSE_TOP_K,
  EMBEDDING_DIM,
  SPARSE_TOP_K,
} from "@/server/rag/types";
import { rowToChunk } from "@/server/db/mapping";

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

export interface SparseSearchRow {
  id: number;
  parentId: number | null;
  documentId: string | null;
  sourceName: string;
  sourceUrl: string;
  text: string;
  rank: number;
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
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new Error("Invalid vector: array is empty or not an array");
  }
  if (vector.length !== EMBEDDING_DIM) {
    throw new Error(`Invalid vector dimension: expected ${EMBEDDING_DIM}, got ${vector.length}`);
  }
  for (let i = 0; i < vector.length; i++) {
    if (typeof vector[i] !== "number" || !Number.isFinite(vector[i])) {
      throw new Error(`Invalid vector element at index ${i}: not a finite number`);
    }
  }
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

  return rows.map((row) => ({ ...rowToChunk(row), similarityScore: Number(row.sim) }));
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

/**
 * Sparse retrieval in Postgres (tsvector + GIN), replacing the in-process
 * BM25 scan of the full 3.5MB corpus. Uses the 'simple' tsconfig (no stemming
 * — tokenizes on whitespace/punctuation, matching the BM25 tokenizer's lexical
 * behavior for the bilingual corpus) and ts_rank for the same style of
 * term-overlap ranking. Returns only top-K, so the server never loads the
 * whole corpus into memory on the FTS path.
 *
 * Fallback contract: if this throws (e.g. the GIN index was never created),
 * the hybrid retriever falls back to in-process BM25 over the cached corpus.
 */
async function sparseSearch(
  prisma: PrismaClient,
  query: string,
  options: { topK?: number } = {},
): Promise<Chunk[]> {
  const topK = options.topK ?? SPARSE_TOP_K;
  const tsQuery = websearchQuery(query);
  if (!tsQuery) {
    return [];
  }

  const rows = await prisma.$queryRaw<SparseSearchRow[]>`
    SELECT
      id,
      "parentId",
      "documentId",
      "sourceName",
      "sourceUrl",
      text,
      ts_rank(to_tsvector('simple', text), ${tsQuery}::tsquery) AS rank
    FROM document_chunks
    WHERE to_tsvector('simple', text) @@ ${tsQuery}::tsquery
    ORDER BY rank DESC
    LIMIT ${topK};
  `;

  return rows.map((row) => ({ ...rowToChunk(row), bm25Score: Number(row.rank) }));
}

/**
 * Common English + German function words. ts_rank without IDF would let these
 * dominate ranking ("is | the | for" matches nearly every English sentence),
 * drowning out the content terms — the opposite of BM25, whose IDF weighting
 * favors rare content words. Dropping them makes FTS ranking approximate BM25.
 */
const FTS_STOPWORDS = new Set([
  // English
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "if",
  "then",
  "else",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "by",
  "at",
  "from",
  "as",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "can",
  "could",
  "should",
  "may",
  "might",
  "must",
  "shall",
  "not",
  "no",
  "so",
  "than",
  "that",
  "this",
  "these",
  "those",
  "it",
  "its",
  "i",
  "you",
  "he",
  "she",
  "we",
  "they",
  "them",
  "their",
  "his",
  "her",
  "my",
  "your",
  "our",
  "who",
  "whom",
  "which",
  "what",
  "when",
  "where",
  "how",
  "why",
  "also",
  "only",
  "just",
  "very",
  "too",
  "much",
  "more",
  "most",
  "such",
  "each",
  "any",
  "all",
  "both",
  "some",
  "per",
  "via",
  "about",
  "into",
  "over",
  "under",
  "between",
  "during",
  "before",
  "after",
  "against",
  // German
  "der",
  "die",
  "das",
  "den",
  "dem",
  "des",
  "ein",
  "eine",
  "einen",
  "einem",
  "einer",
  "eines",
  "und",
  "oder",
  "aber",
  "wenn",
  "dann",
  "sonst",
  "zu",
  "in",
  "auf",
  "für",
  "mit",
  "von",
  "bei",
  "aus",
  "an",
  "als",
  "ist",
  "sind",
  "war",
  "waren",
  "sein",
  "gewesen",
  "haben",
  "hat",
  "hatte",
  "gehabt",
  "wird",
  "werden",
  "wurde",
  "würde",
  "kann",
  "können",
  "konnte",
  "soll",
  "sollen",
  "muss",
  "müssen",
  "nicht",
  "kein",
  "keine",
  "keinen",
  "keinem",
  "so",
  "als",
  "dass",
  "diese",
  "dieser",
  "dieses",
  "es",
  "sie",
  "er",
  "wir",
  "ihr",
  "ihre",
  "ihrer",
  "ihres",
  "mein",
  "meine",
  "dein",
  "deine",
  "sein",
  "seine",
  "unser",
  "unsere",
  "euer",
  "eure",
  "wer",
  "was",
  "wann",
  "wo",
  "wie",
  "warum",
  "auch",
  "nur",
  "sehr",
  "zu",
  "viel",
  "mehr",
  "meisten",
  "solche",
  "jeder",
  "jede",
  "jedes",
  "jeden",
  "alle",
  "beide",
  "manche",
  "pro",
  "über",
  "unter",
  "zwischen",
  "während",
  "vor",
  "nach",
  "gegen",
  "bis",
  "um",
  "ohne",
  "durch",
  "wegen",
]);

/**
 * Builds a Postgres tsquery from a free-text query: lowercases, drops
 * punctuation and function words, and OR-joins the content tokens so any-term
 * matches rank (BM25-style lexical overlap). Returns "" for an empty query.
 */
function websearchQuery(query: string): string {
  const tokens = query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/[\s-]+/)
    .filter((token) => token.length > 1 && !FTS_STOPWORDS.has(token));
  if (tokens.length === 0) {
    return "";
  }
  return tokens.map((token) => token.replace(/'/g, "''")).join(" | ");
}

// ─── Exported namespace ───────────────────────────────────────────────────────

export const vectorQueries = {
  findSimilarChunks,
  findSimilarCacheEntry,
  upsertCacheEntry,
  sparseSearch,
} as const;
