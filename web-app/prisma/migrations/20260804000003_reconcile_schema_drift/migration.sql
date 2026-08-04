-- ─────────────────────────────────────────────────────────────────────────────
-- Reconcile schema drift between the live database and prisma/schema.prisma.
--
-- Verified before writing (psql on the live DB):
--   * documents is EMPTY (0 rows) — enum casts are safe, no data migration needed
--   * DocumentStatus      has PROCESSING; schema declares INGESTING
--   * DocumentSourceType  has MANUAL;   schema declares only URL, PDF
--   * message_feedback.rating / updatedAt carry DB defaults not in schema
--   * documents / message_feedback are missing the schema's @@index pairs
--
-- ⚠ Constraint: this migration is ONLY safe on a database whose `documents`
--   table is empty (or has no rows using PROCESSING/MANUAL). On a data-bearing
--   DB the enum casts would FAIL loudly (not silently corrupt) — deploy it
--   there only after normalizing any such rows.
--
-- Vector indexes (intentional, kept):
--   document_chunks_embedding_idx        — HNSW, used by findSimilarChunks (<=>)
--   idx_semantic_cache_query_vector_hnsw — tuned HNSW, used by findSimilarCacheEntry
--   semantic_cache_queryVector_idx       — DUPLICATE HNSW on the same column as
--                                          idx_semantic_cache_query_vector_hnsw;
--                                          redundant, dropped.
-- Prisma cannot model HNSW indexes on Unsupported("vector(...)") columns, so
-- the two kept HNSW indexes remain as documented divergence in migrate diff.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. DocumentSourceType: drop the MANUAL value (schema = URL, PDF only).
CREATE TYPE "DocumentSourceType_new" AS ENUM ('URL', 'PDF');
ALTER TABLE "public"."documents" ALTER COLUMN "sourceType" DROP DEFAULT;
ALTER TABLE "documents" ALTER COLUMN "sourceType" TYPE "DocumentSourceType_new"
  USING ("sourceType"::text::"DocumentSourceType_new");
ALTER TYPE "DocumentSourceType" RENAME TO "DocumentSourceType_old";
ALTER TYPE "DocumentSourceType_new" RENAME TO "DocumentSourceType";
DROP TYPE "public"."DocumentSourceType_old";
ALTER TABLE "documents" ALTER COLUMN "sourceType" SET DEFAULT 'URL';

-- 2. DocumentStatus: replace PROCESSING with INGESTING (schema's value).
CREATE TYPE "DocumentStatus_new" AS ENUM ('PENDING', 'INGESTING', 'SYNCED', 'FAILED');
ALTER TABLE "public"."documents" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "documents" ALTER COLUMN "status" TYPE "DocumentStatus_new"
  USING ("status"::text::"DocumentStatus_new");
ALTER TYPE "DocumentStatus" RENAME TO "DocumentStatus_old";
ALTER TYPE "DocumentStatus_new" RENAME TO "DocumentStatus";
DROP TYPE "public"."DocumentStatus_old";
ALTER TABLE "documents" ALTER COLUMN "status" SET DEFAULT 'SYNCED';

-- 3. Drop the redundant duplicate HNSW index on semantic_cache.queryVector.
--    The tuned idx_semantic_cache_query_vector_hnsw covers the same column.
DROP INDEX IF EXISTS "semantic_cache_queryVector_idx";

-- 4. message_feedback: schema declares no DB defaults on rating / updatedAt
--    (Prisma manages them); the catch-up migration's defaults are removed.
ALTER TABLE "message_feedback" ALTER COLUMN "rating" DROP DEFAULT;
ALTER TABLE "message_feedback" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- 5. Missing schema-declared btree indexes.
CREATE INDEX "documents_status_updatedAt_idx" ON "documents"("status", "updatedAt" DESC);
CREATE INDEX "message_feedback_rating_createdAt_idx" ON "message_feedback"("rating", "createdAt");
