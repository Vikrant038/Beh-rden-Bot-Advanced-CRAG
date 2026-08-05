-- bge-m3 embedding migration: vector 768 → 1024 + fresh corpus.
--
-- DELIBERATE DESTRUCTIVE STEP (approved model-change migration, 2026-08-05):
-- the corpus was embedded with the English-only BAAI/bge-base-en-v1.5, which
-- scored German text poorly and forced CRAG web-search fallbacks for most
-- queries. The corpus is being re-embedded from scratch with the multilingual
-- BAAI/bge-m3 (1024-dim). The old 768-dim vectors are meaningless in the new
-- space, so the three corpus tables are dropped and recreated empty; `pnpm
-- ingest` then re-scrapes/re-parses/re-embeds the full source list.
--
-- This is a one-time data migration with explicit user sign-off — NOT a
-- rerunnability hack (MIGRATION_POLICY.md §3.3 forbids casual DROP TABLE).

-- 1. Drop the old bge-base corpus (CASCADE removes child rows + HNSW index).
DROP TABLE IF EXISTS "document_chunks" CASCADE;
DROP TABLE IF EXISTS "document_parent_chunks" CASCADE;
DROP TABLE IF EXISTS "documents" CASCADE;

-- 2. Semantic cache: old 768-dim query vectors are meaningless in the new
--    space. Clear rows, widen the column, rebuild the HNSW index (m=16/ef=64).
DELETE FROM "semantic_cache";
DROP INDEX IF EXISTS "idx_semantic_cache_query_vector_hnsw";
ALTER TABLE "semantic_cache" ALTER COLUMN "queryVector" TYPE vector(1024);
CREATE INDEX idx_semantic_cache_query_vector_hnsw
  ON semantic_cache
  USING hnsw ("queryVector" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 3. Recreate the corpus tables (mirror schema.prisma exactly).
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "status" "DocumentStatus" NOT NULL DEFAULT 'SYNCED',
    "sourceType" "DocumentSourceType" NOT NULL DEFAULT 'URL',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "document_parent_chunks" (
    "id" SERIAL NOT NULL,
    "documentId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_parent_chunks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "document_chunks" (
    "id" SERIAL NOT NULL,
    "documentId" TEXT NOT NULL,
    "parentId" INTEGER,
    "sourceName" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "embedding" vector(1024) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- Indexes (HNSW on embedding = the real search index; keep for retrieval).
CREATE UNIQUE INDEX "documents_url_key" ON "documents"("url");
CREATE INDEX "documents_status_updatedAt_idx" ON "documents"("status", "updatedAt" DESC);
CREATE INDEX "document_parent_chunks_documentId_idx" ON "document_parent_chunks"("documentId");
CREATE INDEX "document_chunks_documentId_idx" ON "document_chunks"("documentId");
CREATE INDEX "document_chunks_sourceName_idx" ON "document_chunks"("sourceName");
CREATE INDEX "document_chunks_parentId_idx" ON "document_chunks"("parentId");
CREATE INDEX "document_chunks_embedding_idx"
  ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops);

-- Foreign keys (ON DELETE CASCADE matches schema.prisma relations).
ALTER TABLE "document_parent_chunks" ADD CONSTRAINT "document_parent_chunks_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "document_parent_chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. PoLP re-assertion (MIGRATION_POLICY §2): the app role needs DML on the
--    recreated corpus tables. Explicit grants keep fresh DBs (migration role
--    = behoerden_migrator) and legacy local DBs (role = behoerden_user, where
--    the default privileges do not apply) consistent. Idempotent.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "documents", "document_parent_chunks", "document_chunks", "semantic_cache"
  TO "behoerden_app";
GRANT USAGE, SELECT ON SEQUENCE
  "document_parent_chunks_id_seq", "document_chunks_id_seq", "semantic_cache_id_seq"
  TO "behoerden_app";
