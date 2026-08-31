/**
 * Background ingest job queue — the production upgrade path documented in
 * `pipeline.ts`. URL/PDF ingestion (scrape + chunk + embed) can exceed the
 * serverless request budget, so the admin surface enqueues work here instead
 * of blocking on it. The queue drains serially (concurrency 1,
 * embedding-rate-limit friendly) via `drainPendingJobs()`, which the admin
 * UI's poll loop calls on every tick — no per-minute cron required (Vercel
 * Hobby only allows daily crons), and the Pro-plan
 * `/api/cron/process-ingest-jobs` route wraps the same worker.
 *
 * Design notes:
 * - Postgres-only by design: no Redis/BullMQ/Inngest dependency, so this runs
 *   identically on the local docker compose and on Vercel/Neon.
 * - Jobs are transient: DONE/FAILED rows are pruned after 24 h, so PDF
 *   payloads (bytea) never accumulate long-term.
 * - Crash-safe: RUNNING jobs whose lease (startedAt) expired are re-queued.
 * - The core pipeline functions (`ingestUrl`, `ingestPdf`) are unchanged; the
 *   worker is a thin orchestration layer over them.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { ingestUrl, ingestPdf } from "@/server/ingest/pipeline";
import {
  createTranslationRateLimiter,
  type TranslationRateLimiter,
} from "@/server/ingest/translate";

/**
 * Shared rate limiter for background ingest jobs (admin upload / re-sync).
 * Multi-key when GROQ_API_KEYS is set — see createTranslationRateLimiter.
 * Lazy singleton: built on the first job that needs it, not at import time.
 */
let jobsRateLimiter: TranslationRateLimiter | undefined;
function getJobsRateLimiter(): TranslationRateLimiter {
  jobsRateLimiter ??= createTranslationRateLimiter();
  return jobsRateLimiter;
}

import { createLogger } from "@/server/lib/logger";

const logger = createLogger("ingest-jobs");

/** A RUNNING job whose lease is older than this is presumed crashed and re-queued. */
const RUNNING_LEASE_MS = 10 * 60 * 1000;
/** A crashed job past this many attempts is failed permanently instead of re-queued. */
const MAX_ATTEMPTS = 3;
/** Prune finished jobs older than this. */
const PRUNE_AFTER_MS = 24 * 60 * 60 * 1000;

export type IngestJobType = "URL" | "PDF";
export type IngestJobStatus = "QUEUED" | "RUNNING" | "DONE" | "FAILED";

export interface JobEnqueueResult {
  jobId: string;
  /** False when a pending job for the same source already exists (dedupe). */
  queued: boolean;
}

export interface JobView {
  id: string;
  type: IngestJobType;
  status: IngestJobStatus;
  error: string | null;
  result: unknown;
  createdAt: Date;
  finishedAt: Date | null;
}

export interface JobStats {
  queued: number;
  running: number;
  done24h: number;
  failed24h: number;
}

/** True when the job is still in flight (QUEUED or RUNNING). */
export function isJobPending(status: IngestJobStatus): boolean {
  return status === "QUEUED" || status === "RUNNING";
}

/**
 * Enqueues a URL ingest job. Dedupes: when an identical job for the same URL
 * is already QUEUED/RUNNING, no second row is created (prevents double-embed
 * on repeated admin clicks or overlapping cron ticks).
 */
export async function enqueueUrlJob(
  url: string,
  options: { title?: string; force?: boolean } = {},
): Promise<JobEnqueueResult> {
  // Dedupe ignores `force` by design: a force re-sync only re-ingests jobs
  // actually enqueued (content-hash bypass happens at ingest time), it does
  // not double-embed an already-pending document.
  const duplicate = await prisma.ingestJob.findFirst({
    where: { type: "URL", url, status: { in: ["QUEUED", "RUNNING"] } },
    select: { id: true },
  });
  if (duplicate) {
    logger.info({ url, jobId: duplicate.id }, "[INGEST JOB] duplicate URL job skipped");
    return { jobId: duplicate.id, queued: false };
  }

  const job = await prisma.ingestJob.create({
    data: {
      type: "URL",
      url,
      title: options.title?.trim() || null,
      force: options.force ?? false,
    },
    select: { id: true },
  });
  logger.info({ url, jobId: job.id }, "[INGEST JOB] URL job enqueued");
  return { jobId: job.id, queued: true };
}

/**
 * Enqueues a PDF ingest job with the raw buffer stored as bytea (≤4 MiB by
 * upload-route validation). Pruned after completion like all other jobs.
 */
export async function enqueuePdfJob(
  buffer: Uint8Array<ArrayBuffer>,
  filename: string,
  title?: string,
): Promise<JobEnqueueResult> {
  const job = await prisma.ingestJob.create({
    data: {
      type: "PDF",
      payload: buffer,
      filename,
      title: title?.trim() || null,
    },
    select: { id: true },
  });
  logger.info({ filename, jobId: job.id, bytes: buffer.length }, "[INGEST JOB] PDF job enqueued");
  return { jobId: job.id, queued: true };
}

/**
 * "Sync all" — enqueues one URL job per existing document. Returns the number
 * of jobs actually enqueued (deduped) plus the newest job id for polling.
 */
export async function enqueueSyncJobs(
  options: { force?: boolean } = {},
): Promise<{ jobIds: string[]; enqueued: number; alreadyPending: number }> {
  const documents = await prisma.document.findMany({ select: { url: true } });
  const results = await Promise.all(
    documents.map((document) => enqueueUrlJob(document.url, { force: options.force })),
  );
  const enqueued = results.filter((result) => result.queued).length;
  const alreadyPending = results.length - enqueued;
  logger.info(
    { total: documents.length, enqueued, alreadyPending },
    "[INGEST JOB] sync-all enqueued",
  );
  return {
    jobIds: results.map((result) => result.jobId),
    enqueued,
    alreadyPending,
  };
}

/**
 * Cron worker entry: claims and runs jobs serially until either `maxJobs` are
 * processed or `timeBudgetMs` elapses (leaving headroom under the 60 s
 * serverless cap so the response is never cut off mid-write). Then prunes
 * finished jobs.
 */
export async function processIngestJobs(
  options: { maxJobs?: number; timeBudgetMs?: number } = {},
): Promise<{ processed: number; remaining: number }> {
  const maxJobs = Math.max(1, options.maxJobs ?? 25);
  const timeBudgetMs = Math.max(1_000, options.timeBudgetMs ?? 50_000);
  const startedAt = Date.now();

  let processed = 0;
  for (;;) {
    if (processed >= maxJobs || Date.now() - startedAt >= timeBudgetMs) {
      break;
    }
    const job = await claimNextJob();
    if (!job) {
      break;
    }
    try {
      await runJob(job, () => Date.now() - startedAt >= timeBudgetMs);
      processed += 1;
    } catch (error) {
      // runJob catches its own failures; this is a safety net (e.g. DB outage).
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ jobId: job.id, error: message }, "[INGEST JOB] worker failure");
      await markJobFailed(job.id, message).catch((error) => {
        logger.warn({ jobId: job.id, error: String(error) }, "[INGEST JOB] markJobFailed failed");
      });
      processed += 1;
    }
  }

  await pruneOldJobs().catch((error) => {
    logger.warn({ error: String(error) }, "[INGEST JOB] prune failed");
  });

  const remaining = await prisma.ingestJob.count({
    where: { status: { in: ["QUEUED", "RUNNING"] } },
  });
  logger.info({ processed, remaining }, "[INGEST JOB] worker tick complete");
  return { processed, remaining };
}

/**
 * Atomically claims the oldest QUEUED job. First re-queues RUNNING jobs whose
 * lease expired (crashed worker recovery), failing permanently any that are
 * past the retry cap. Then flips one QUEUED row to RUNNING. The claim checks
 * the update count, so under concurrent ticks only the winner processes the
 * job; the loser returns null.
 */
async function claimNextJob() {
  const leaseExpired = { lt: new Date(Date.now() - RUNNING_LEASE_MS) };

  await prisma.ingestJob.updateMany({
    where: { status: "RUNNING", startedAt: leaseExpired, attempts: { lt: MAX_ATTEMPTS } },
    data: { status: "QUEUED", startedAt: null },
  });
  await prisma.ingestJob.updateMany({
    where: { status: "RUNNING", startedAt: leaseExpired, attempts: { gte: MAX_ATTEMPTS } },
    data: { status: "FAILED", finishedAt: new Date(), error: "Max attempts exceeded" },
  });

  return prisma.$transaction(async (tx) => {
    const candidate = await tx.ingestJob.findFirst({
      where: { status: "QUEUED" },
      orderBy: { createdAt: "asc" },
      take: 1,
    });
    if (!candidate) {
      return null;
    }
    const claimed = await tx.ingestJob.updateMany({
      where: { id: candidate.id, status: "QUEUED" },
      data: { status: "RUNNING", startedAt: new Date(), attempts: { increment: 1 } },
    });
    if (claimed.count === 0) {
      // Another tick claimed it first — do not process the row we didn't win.
      return null;
    }
    return tx.ingestJob.findUnique({ where: { id: candidate.id } });
  });
}

/** Runs one claimed job and finalizes its row + the target document status. */
async function runJob(
  job: {
    id: string;
    type: IngestJobType;
    url: string | null;
    title: string | null;
    filename: string | null;
    payload: Uint8Array<ArrayBuffer> | null;
    force: boolean;
    progress: number;
  },
  isBudgetExhausted: () => boolean,
): Promise<void> {
  if (job.type === "PDF") {
    if (!job.payload || !job.filename) {
      throw new Error("PDF job missing payload or filename");
    }
    const result = await ingestPdf(Buffer.from(job.payload), job.filename, {
      ...(job.title ? { title: job.title } : {}),
      resumeFrom: job.progress,
      isBudgetExhausted,
      normalizeEnglish: true,
      rateLimiter: getJobsRateLimiter(),
    });
    await finalizeJob(job.id, result);
    return;
  }

  if (!job.url) {
    throw new Error("URL job missing url");
  }
  const result = await ingestUrl(job.url, {
    ...(job.title ? { title: job.title } : {}),
    force: job.force,
    normalizeEnglish: true,
    rateLimiter: getJobsRateLimiter(),
  });
  await finalizeJob(job.id, result);
}

/**
 * Marks a job DONE/FAILED from its pipeline result and keeps the target
 * document's status in sync (SYNCED/FAILED) so the admin list reflects real
 * state instead of stale-updatedAt inference.
 */
async function finalizeJob(
  jobId: string,
  result: { url: string; status: string; error?: string; nextBlock?: number },
): Promise<void> {
  if (result.status === "progress") {
    await prisma.ingestJob.update({
      where: { id: jobId },
      data: {
        status: "QUEUED",
        progress: result.nextBlock ?? 0,
        startedAt: null,
        attempts: 0,
      },
    });
    return;
  }

  if (result.status === "failed") {
    await markJobFailed(jobId, result.error ?? "Ingest failed");
    // The document row may exist from a previous successful ingest; mark it
    // failed so the admin list surfaces the regression.
    await prisma.document
      .updateMany({
        where: { url: result.url },
        data: { status: "FAILED", lastError: (result.error ?? "").slice(0, 1000) },
      })
      .catch((error) => {
        logger.warn(
          { jobId, url: result.url, error: String(error) },
          "[INGEST JOB] document FAILED update failed",
        );
      });
    return;
  }

  await prisma.ingestJob.update({
    where: { id: jobId },
    data: {
      status: "DONE",
      finishedAt: new Date(),
      error: null,
      result: result as unknown as Prisma.InputJsonValue,
    },
  });
  await prisma.document
    .updateMany({
      where: { url: result.url },
      data: { status: "SYNCED", lastError: null },
    })
    .catch((error) => {
      logger.warn(
        { jobId, url: result.url, error: String(error) },
        "[INGEST JOB] document SYNCED update failed",
      );
    });
}

async function markJobFailed(jobId: string, error: string): Promise<void> {
  await prisma.ingestJob.update({
    where: { id: jobId },
    data: { status: "FAILED", finishedAt: new Date(), error: error.slice(0, 2000) },
  });
}

async function pruneOldJobs(): Promise<void> {
  const cutoff = new Date(Date.now() - PRUNE_AFTER_MS);
  await prisma.ingestJob.deleteMany({
    where: {
      status: { in: ["DONE", "FAILED"] },
      finishedAt: { lt: cutoff },
    },
  });
}

/**
 * Hobby-compatible on-demand drain: Vercel Hobby only allows a single daily
 * cron, so `/api/cron/process-ingest-jobs` cannot be scheduled every five
 * minutes on the free plan. Instead the admin UI's 2.5 s poll loop
 * (jobGet/jobStats) calls this, which runs the same bounded worker tick
 * whenever jobs are pending. No-ops on an empty queue, so idle polling costs
 * one cheap count query.
 */
export async function drainPendingJobs(
  options: { maxJobs?: number; timeBudgetMs?: number } = {},
): Promise<{ drained: boolean; processed: number; remaining: number }> {
  const pending = await prisma.ingestJob.count({
    where: { status: { in: ["QUEUED", "RUNNING"] } },
  });
  if (pending === 0) {
    return { drained: false, processed: 0, remaining: 0 };
  }
  const result = await processIngestJobs(options);
  return { drained: true, ...result };
}

/** Single-job view for the admin UI's poll loop. */
export async function getJob(id: string): Promise<JobView | null> {
  const job = await prisma.ingestJob.findUnique({ where: { id } });
  if (!job) {
    return null;
  }
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    error: job.error,
    // Map to `unknown` so the tRPC client type does not carry the deeply
    // recursive Prisma JsonValue union (TS2589).
    result: job.result as unknown,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
  };
}

/** Queue-depth view for the admin UI. */
export async function getJobStats(): Promise<JobStats> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [queued, running, done24h, failed24h] = await Promise.all([
    prisma.ingestJob.count({ where: { status: "QUEUED" } }),
    prisma.ingestJob.count({ where: { status: "RUNNING" } }),
    prisma.ingestJob.count({ where: { status: "DONE", finishedAt: { gte: since } } }),
    prisma.ingestJob.count({ where: { status: "FAILED", finishedAt: { gte: since } } }),
  ]);
  return { queued, running, done24h, failed24h };
}
