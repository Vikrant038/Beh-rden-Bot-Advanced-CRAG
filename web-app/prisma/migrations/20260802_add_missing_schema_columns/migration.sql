-- ─────────────────────────────────────────────────────────────────────────────
-- Catch-up migration: applies all schema additions that exist in schema.prisma
-- but were never generated as individual migration files (schema drift).
--
-- Safe to re-run: every statement uses IF NOT EXISTS / IF EXISTS guards.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. conversations: soft-delete and pinned columns
-- (referenced by conversation.list, conversation.delete, conversation.restore)
ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "pinned" BOOLEAN NOT NULL DEFAULT false;

-- Composite index used by the list query (userId, deletedAt, pinned, updatedAt)
CREATE INDEX IF NOT EXISTS "conversations_userId_deletedAt_pinned_updatedAt_idx"
  ON "conversations"("userId", "deletedAt", "pinned", "updatedAt" DESC);

-- 2. document_parent_chunks table (parent-child chunking — §add_parent_child_chunks)
CREATE TABLE IF NOT EXISTS "document_parent_chunks" (
  "id" SERIAL NOT NULL,
  "documentId" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "document_parent_chunks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "document_parent_chunks_documentId_idx"
  ON "document_parent_chunks"("documentId");

ALTER TABLE "document_parent_chunks"
  DROP CONSTRAINT IF EXISTS "document_parent_chunks_documentId_fkey";

ALTER TABLE "document_parent_chunks"
  ADD CONSTRAINT "document_parent_chunks_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. document_chunks: parentId FK column
ALTER TABLE "document_chunks"
  ADD COLUMN IF NOT EXISTS "parentId" INTEGER;

CREATE INDEX IF NOT EXISTS "document_chunks_parentId_idx"
  ON "document_chunks"("parentId");

ALTER TABLE "document_chunks"
  DROP CONSTRAINT IF EXISTS "document_chunks_parentId_fkey";

ALTER TABLE "document_chunks"
  ADD CONSTRAINT "document_chunks_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "document_parent_chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. documents: status, sourceType, lastError columns
--    (Document model expanded beyond original add_document_model migration)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DocumentStatus') THEN
    CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'PROCESSING', 'SYNCED', 'FAILED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DocumentSourceType') THEN
    CREATE TYPE "DocumentSourceType" AS ENUM ('URL', 'PDF', 'MANUAL');
  END IF;
END$$;

ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "status" "DocumentStatus" NOT NULL DEFAULT 'SYNCED',
  ADD COLUMN IF NOT EXISTS "sourceType" "DocumentSourceType" NOT NULL DEFAULT 'URL',
  ADD COLUMN IF NOT EXISTS "lastError" TEXT;

-- 5. pipeline_runs table
CREATE TABLE IF NOT EXISTS "pipeline_runs" (
  "id" TEXT NOT NULL,
  "prompt" TEXT NOT NULL,
  "traceJson" JSONB NOT NULL,
  "latencyMs" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'SUCCESS',
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pipeline_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "pipeline_runs_createdAt_idx"
  ON "pipeline_runs"("createdAt" DESC);

-- 6. message_feedback table (referenced by User model)
CREATE TABLE IF NOT EXISTS "message_feedback" (
  "id" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "rating" SMALLINT NOT NULL,
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "message_feedback_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "message_feedback_messageId_userId_key"
  ON "message_feedback"("messageId", "userId");

ALTER TABLE "message_feedback"
  DROP CONSTRAINT IF EXISTS "message_feedback_messageId_fkey";
ALTER TABLE "message_feedback"
  ADD CONSTRAINT "message_feedback_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "message_feedback"
  DROP CONSTRAINT IF EXISTS "message_feedback_userId_fkey";
ALTER TABLE "message_feedback"
  ADD CONSTRAINT "message_feedback_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
