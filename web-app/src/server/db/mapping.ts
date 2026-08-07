/**
 * Row → domain-object mapping for database reads.
 *
 * This is the single source of truth for turning a raw DB row (whether from a
 * Prisma ORM query or a `$queryRaw` pgvector query) into a domain `Chunk` /
 * `Source` object. Before this module existed, the same 6-line mapping was
 * copy-pasted at three call sites (vector-queries.ts, corpus.ts) and the
 * semantic-cache payload contract was re-implemented twice inside
 * `semantic-cache.ts`. Centralizing it here means a consumer that needs a
 * `Chunk` calls `rowToChunk` — it never hand-maps a row.
 */

import type { Chunk, Source } from "@/server/rag/types";

/** Raw row shape shared by every pgvector / Prisma chunk read. */
export interface ChunkRow {
  id: number | string;
  parentId?: number | string | null;
  documentId?: string | null;
  sourceName: string;
  sourceUrl: string;
  text: string;
  similarityScore?: number;
  bm25Score?: number;
}

/** The one place that knows how a DB chunk row becomes a domain `Chunk`. */
export function rowToChunk(row: ChunkRow): Chunk {
  return {
    id: String(row.id),
    parentId: row.parentId == null ? undefined : String(row.parentId),
    documentId: row.documentId ?? undefined,
    sourceName: row.sourceName,
    sourceUrl: row.sourceUrl,
    text: row.text,
    ...(row.similarityScore !== undefined ? { similarityScore: row.similarityScore } : {}),
    ...(row.bm25Score !== undefined ? { bm25Score: row.bm25Score } : {}),
  };
}

/**
 * Shape of a semantic-cache `responseJson` blob. Fields are required on the
 * parsed result because `parseCachePayload` always fills a default for any
 * missing/malformed field — consumers never have to null-check.
 */
export interface CachePayload {
  answer: string;
  sources: Source[];
}

/**
 * Parses a semantic-cache `responseJson` blob into a typed payload. The
 * `responseJson` contract (an object with optional `answer` string and sources
 * array) is defined here once, so cache reads and writes share the same shape.
 */
export function parseCachePayload(responseJson: unknown): CachePayload {
  const data: CachePayload = responseJson && typeof responseJson === "object"
    ? (responseJson as CachePayload)
    : { answer: "", sources: [] };
  return {
    answer: typeof data.answer === "string" ? data.answer : "",
    sources: Array.isArray(data.sources) ? data.sources : [],
  };
}