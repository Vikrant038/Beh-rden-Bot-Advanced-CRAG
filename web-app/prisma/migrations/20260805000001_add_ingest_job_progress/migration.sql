-- ─────────────────────────────────────────────────────────────────────────────
-- Add `progress` to ingest_jobs: resumable-ingest cursor for PDF jobs.
--
-- Large PDFs (e.g. the Residence Act → ~4,000 child chunks) exceed the Vercel
-- serverless 60 s cap inside a single embed+store pass. The worker now embeds
-- and stores per parent-block, checks the time budget after each block, and —
-- when the budget is about to expire — returns the job to QUEUED with this
-- cursor so the next cron tick resumes from the last stored block instead of
-- re-embedding everything from scratch.
--
-- `progress` counts parent blocks fully embedded + stored. 0 = not started.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "ingest_jobs" ADD COLUMN "progress" INTEGER NOT NULL DEFAULT 0;
