#!/usr/bin/env tsx
/**
 * English-first corpus migration script.
 *
 * Migrates the entire knowledge base to English-normalized text:
 *   1. Clears the semantic cache.
 *   2. Iterates every document in the database and re-ingests it through the
 *      English-first pipeline (detect → translate → chunk → embed → store).
 *   3. The translation step is rate-limited to Groq's free tier (30 RPM /
 *      6,000 TPM / 14,400 RPD) and checkpoint-cached, so interrupted runs
 *      resume without re-translating.
 *
 * Usage:
 *   pnpm tsx scripts/translate-corpus.ts
 *
 * Estimated time on Groq free tier: ~1–4 hours depending on how many sources
 * are already English (they skip translation). Set GROQ_API_KEYS to a
 * comma-separated list of keys from DIFFERENT Groq accounts to translate in
 * parallel (one worker per key, each key's free-tier bucket used
 * independently — free-tier limits are per organization, so same-account keys
 * share one bucket and gain nothing). Set GROQ_RPM / GROQ_TPM env vars for
 * paid-plan limits.
 *
 * Prerequisites:
 *   - GROQ_API_KEY set (translation)
 *   - DATABASE_URL set (ingest target)
 *   - AI_INFERENCE_URL + AI_INFERENCE_TOKEN set (or HF_INFERENCE_URL + HF_TOKEN)
 *   - The embeddings worker must be reachable (for re-embedding translated text)
 */

import { prisma } from "@/server/db";
import { semanticCache } from "@/server/rag/cache/semantic-cache";
import { syncAllDocuments, type IngestOptions } from "@/server/ingest/pipeline";
import { createTranslationRateLimiter, detectLanguage } from "@/server/ingest/translate";
import { createLogger } from "@/server/lib/logger";

const logger = createLogger("translate-corpus");

async function main(): Promise<void> {
  logger.info("[MIGRATE] Starting English-first corpus migration");

  // ── Step 1: Clear the semantic cache ──────────────────────────────────
  logger.info("[MIGRATE] Clearing semantic cache…");
  try {
    await prisma.$executeRawUnsafe("TRUNCATE TABLE semantic_cache RESTART IDENTITY CASCADE");
    logger.info("[MIGRATE] Semantic cache cleared");
  } catch (error) {
    logger.warn(
      { error: String(error) },
      "[MIGRATE] Could not clear semantic cache (table may not exist) — continuing",
    );
  }

  // ── Step 2: Count the corpus ──────────────────────────────────────────
  const total = await prisma.document.count();
  logger.info("[MIGRATE] %d documents in the corpus", total);

  if (total === 0) {
    logger.info("[MIGRATE] No documents to migrate — done");
    return;
  }

  // ── Step 3: Estimate translation work ─────────────────────────────────
  // Sample a few documents to estimate how many need translation.
  const samples = await prisma.document.findMany({
    select: { url: true, title: true },
    take: Math.min(10, total),
    orderBy: { createdAt: "desc" },
  });
  const germanSample = samples.filter(
    (s) => detectLanguage(s.title) === "de" || detectLanguage(s.url) === "de",
  );
  const germanRatio = germanSample.length / samples.length;
  const estimatedGerman = Math.round(total * germanRatio);
  logger.info(
    "[MIGRATE] Est. ~%d/%d documents need translation (sample: %d/%d German)",
    estimatedGerman,
    total,
    germanSample.length,
    samples.length,
  );

  // ── Step 4: Run the re-ingest ─────────────────────────────────────────
  const limiter = createTranslationRateLimiter();
  // One worker per API key saturates every key's bucket; capped so a huge
  // key list never thrashes the DB. Extra workers beyond keys simply queue
  // on the pool (no harm).
  const concurrency = Math.min(limiter.size, 4);
  const opts: IngestOptions = {
    normalizeEnglish: true,
    rateLimiter: limiter,
  };

  logger.info("[MIGRATE] Re-ingesting all documents through the English-first pipeline…");
  logger.info(
    "[MIGRATE] Rate-limiter: model=%s, keys=%d, concurrency=%d, rpm=%d/key, tpm=%d/key, rpd=%d/key",
    limiter.model,
    limiter.size,
    concurrency,
    limiter.rpm,
    limiter.tpm,
    limiter.rpd,
  );

  const results = await syncAllDocuments(opts, { concurrency });

  // ── Step 5: Summary ───────────────────────────────────────────────────
  const succeeded = results.filter((r) => r.status !== "failed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const totalChunks = results.reduce((sum, r) => sum + r.chunkCount, 0);

  logger.info(
    "[MIGRATE] Done — %d succeeded, %d skipped, %d failed, %d total chunks",
    succeeded,
    skipped,
    failed,
    totalChunks,
  );

  if (failed > 0) {
    for (const r of results.filter((r) => r.status === "failed")) {
      logger.warn({ url: r.url, error: r.error }, "[MIGRATE] Failed document");
    }
  }

  // ── Step 6: Verify ────────────────────────────────────────────────────
  const newCount = await prisma.document.count();
  const newChunks = await prisma.documentChunk.count();
  logger.info("[MIGRATE] Verification: %d documents, %d chunks in DB", newCount, newChunks);

  if (newChunks === 0) {
    logger.error("[MIGRATE] No chunks after migration — something went wrong");
    process.exitCode = 1;
    return;
  }

  logger.info("[MIGRATE] Migration complete. Re-run the CRAG evaluation to verify quality.");
}

main().catch((error) => {
  logger.error({ error: String(error) }, "[MIGRATE] Fatal error");
  process.exit(1);
});
