# ADR: Checkpointed Postgres Resumption for Background Ingest

- **Status:** Accepted (implementation in progress)
- **Date:** 2026-08-05
- **Scope:** `web-app` background ingest queue (`src/server/ingest/jobs.ts`, `pipeline.ts`)

## Context

Admin URL/PDF ingestion can exceed the 60-second Vercel serverless ceiling. The
shipping pattern — enqueue → `202` + `jobId` → Vercel Cron drains serially →
frontend polls `document.jobGet` — works for small documents but not large ones.

Measured on the Residence Act PDF (`../data/pdfs/laws/englisch_aufenthg.pdf`,
1.43 MB, via `scripts/measure-ingest.ts`):

- 387 parent chunks → **3,984 child chunks**
- Embedding is the tail: ~40 `batchEmbedContents` calls (batch of 100) plus
  parse + chunk + one big transaction — far beyond 60 s.

**Failure mode under the ceiling is worse than slow — it is permanent:**

1. The worker's `timeBudgetMs` (50 s) is checked **between jobs, never
   mid-job**, so a large PDF runs until Vercel kills the function.
2. The job is left `RUNNING`; after the 10-min lease expiry the next cron tick
   re-claims it and **restarts from scratch** — every embedding already paid for
   is thrown away.
3. After 3 killed claims the job is permanently `FAILED: "Max attempts
   exceeded"`. Large PDFs can therefore **never complete** under the current
   code.

The queue is deliberately **Postgres-only by design** (`jobs.ts` header:
"no Redis/BullMQ/Inngest dependency, so this runs identically on the local
docker compose and on Vercel/Neon"). The project has just removed all
non-Postgres stores (Milvus removal → Postgres-only revert), so any replacement
must preserve that property.

## Options Considered

### 1. BullMQ + Redis (e.g. Upstash) — Rejected

- Reintroduces a non-Postgres store the project just removed, plus a paid
  dependency and operational surface (eviction, connections).
- **BullMQ does not fix the Vercel problem**: BullMQ workers are long-running
  processes; inside a serverless cron route the worker is still bound by the
  same 60 s function cap. Correct use would require separate always-on worker
  infrastructure — a larger move than a ~40-document corpus warrants.

### 2. Inngest — Rejected (on merit, not on quality)

- Postgres-backed state, serverless-native, resumable steps — the most
  defensible external option.
- Adds a managed-service/account dependency and vendor lock-in for what is
  currently one queue with one worker; its retry/step semantics would wrap the
  same pipeline rather than replace it.

### 3. Checkpointed Postgres resumption — Accepted

Keep Postgres as the single store; make the existing queue resumable:

- **Progress cursor** (`progress Int`, block cursor) on `IngestJob`.
- The embed+store tail of `persistIngested` processes **per parent-block** and
  commits after each block, instead of one atomic mega-transaction.
- The worker checks the time budget **mid-job, between blocks**. When the
  budget is about to expire it persists the cursor and returns the job to
  `QUEUED` (a graceful yield, not a crash) — the next cron tick resumes from
  the offset. No re-parse, no re-embedding of completed blocks.
- Only the final batch performs the document-commit + cache invalidation.
- The crash path is unchanged: lease expiry re-queues, and 3 real crashes still
  fail the job. Graceful yields do not count as crashes.

Result: a ~4,000-chunk PDF completes across 4–8 cron ticks (~20–40 min
background), zero wasted embeddings, zero new infrastructure, identical
behavior on local docker and Vercel/Neon.

## Consequences

**Positive**

- Preserves the Postgres-only property (single store, PoLP roles unchanged).
- No new infrastructure or paid dependency; CI footprint unchanged.
- Resumable across serverless ticks; large PDFs become completable.
- Existing `202` + `jobGet` polling UI is untouched.

**Negative / tradeoffs**

- More complex worker + pipeline split (block-batched, cursor-aware).
- One additive migration (`progress` column) — hand-written per
  `MIGRATION_POLICY.md`.
- Per-block commits are more write churn than the old single transaction.
- Scoped **PDF-first**: URL jobs stay on the current path initially.

**Cost estimate:** comparable to wiring BullMQ, without the Redis dependency.

## Related

- `docs/status/phase-h-resumable-ingest.md` — corpus measurements and sizing.
- `src/server/ingest/jobs.ts` — queue design notes (Postgres-only by design).
- Session handoff: `docs/status/session-handoff-2026-08-04.md` (item 3: the
  corrected recommendation replacing BullMQ).
