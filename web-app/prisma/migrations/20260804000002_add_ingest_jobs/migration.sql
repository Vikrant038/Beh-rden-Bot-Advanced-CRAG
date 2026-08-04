-- Background ingest job queue (Vercel Cron worker). The `vector` extension
-- already exists in the target DB (provisioned by docker/postgres-init.sql as
-- superuser), so no CREATE EXTENSION is emitted here.

-- CreateEnum
CREATE TYPE "IngestJobType" AS ENUM ('URL', 'PDF');

-- CreateEnum
CREATE TYPE "IngestJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "ingest_jobs" (
    "id" TEXT NOT NULL,
    "type" "IngestJobType" NOT NULL,
    "url" TEXT,
    "title" TEXT,
    "payload" BYTEA,
    "filename" TEXT,
    "force" BOOLEAN NOT NULL DEFAULT false,
    "status" "IngestJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ingest_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ingest_jobs_status_createdAt_idx" ON "ingest_jobs"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ingest_jobs_createdAt_idx" ON "ingest_jobs"("createdAt" DESC);
