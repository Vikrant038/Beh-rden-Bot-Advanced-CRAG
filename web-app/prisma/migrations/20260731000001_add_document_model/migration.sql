-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- AlterTable (add nullable first so pre-existing rows can be backfilled)
ALTER TABLE "document_chunks" ADD COLUMN "documentId" TEXT;

-- Backfill any pre-existing chunks into a single legacy document
INSERT INTO "documents" ("id", "title", "url", "hash", "chunkCount", "createdAt", "updatedAt")
SELECT 'legacy-import', 'Legacy Import', '', '', COUNT(*), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "document_chunks"
HAVING COUNT(*) > 0;

UPDATE "document_chunks" SET "documentId" = 'legacy-import' WHERE "documentId" IS NULL;

ALTER TABLE "document_chunks" ALTER COLUMN "documentId" SET NOT NULL;

-- DropIndex (m1: redundant with unique semantic_cache_queryHash_key)
DROP INDEX "semantic_cache_queryHash_idx";

-- CreateIndex
CREATE UNIQUE INDEX "documents_url_key" ON "documents"("url");

-- CreateIndex
CREATE INDEX "document_chunks_documentId_idx" ON "document_chunks"("documentId");

-- AddForeignKey
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
