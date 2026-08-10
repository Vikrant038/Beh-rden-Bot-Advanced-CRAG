#!/usr/bin/env tsx
/**
 * English-first corpus migration script.
 *
 * Migrates the entire knowledge base to English-normalized text:
 *   1. Clears the semantic cache.
 *   2. Iterates every document in the database and re-ingests it through the
 *      English-first pipeline (detect → translate → chunk → embed → store).
 *   3. The translation step is rate-limited to Groq's free tier (30 RPM /
 *      6,000 TPM / 14,400 RPD, plus the model's daily TPD cap — e.g. 100K/day
 *      for llama-3.3-70b, 500K/day for llama-4-scout) and checkpoint-cached,
 *      so interrupted runs resume without re-translating.
 *
 * Usage:
 *   pnpm tsx scripts/translate-corpus.ts
 *
 * ⚠️  Free-tier daily token caps dominate runtime. The ~260K tokens of German
 * text need ~800K–1.2M tokens in+out total. The rate limiter now runs a
 * quality-first MODEL CHAIN (llama-3.3-70b → llama-4-scout → qwen3-32b →
 * gpt-oss-120b → gpt-oss-20b → kimi-k2 → llama-3.1-8b): when a model's daily
 * TPD budget is spent on all keys it falls back to the next model, and when
 * every model is spent it waits for the midnight reset (checkpoint-cached, so
 * a run resumes across days). The chain's combined budget is ~2.3M tokens/day,
 * so the whole corpus typically finishes within a day or two.
 *   Override: GROQ_TRANSLATE_MODELS="a,b,c" (chain order), or
 *   GROQ_TRANSLATE_MODEL="x" (single) — GROQ_TPD overrides the daily cap.
 *
 * Set GROQ_API_KEYS to a comma-separated list of keys (1–N; 3 keys → a
 * 3-key pool, 2 → 2, 1 → a single limiter). Keys from DIFFERENT Groq
 * accounts each bring their own quota; same-account keys share the org
 * bucket, so the pool degrades gracefully to one effective quota.
 *
 * Prerequisites:
 *   - GROQ_API_KEY set (translation)
 *   - DATABASE_URL set (ingest target)
 *   - A reachable embedding endpoint: AI_INFERENCE_URL + AI_INFERENCE_TOKEN
 *     (Cloudflare worker) or HF_INFERENCE_URL + HF_TOKEN. The script now
 *     pre-flights this and aborts with a clear message if unreachable.
 *   - The PDFs must exist under data/pdfs (the ~40 pdf:// documents are
 *     re-ingested from disk, not re-scraped).
 */

// Load .env (GROQ_API_KEYS, DATABASE_URL, …) — tsx does not auto-inject it.
import "dotenv/config";

import { prisma } from "@/server/db";
import { syncAllDocuments, type IngestOptions } from "@/server/ingest/pipeline";
import { createDefaultEmbeddingClient } from "@/server/embeddings/client";
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

  // ── Step 3: Pre-flight checks ─────────────────────────────────────────
  // 3a. Embedding endpoint must be reachable BEFORE we spend any translation
  //     tokens — the previous run translated docs and then failed at embed
  //     (dead localhost endpoint), which rolled the docs back.
  const embeddingClient = createDefaultEmbeddingClient();
  try {
    await embeddingClient.embedTexts(["connectivity check"]);
    logger.info("[MIGRATE] Embedding endpoint reachable");
  } catch (error) {
    logger.error(
      { error: String(error) },
      "[MIGRATE] Embedding endpoint unreachable — set HF_INFERENCE_URL + HF_TOKEN " +
        "(or AI_INFERENCE_URL + AI_INFERENCE_TOKEN) to a reachable BGE-M3 endpoint " +
        "(e.g. your Cloudflare embeddings worker) in .env and re-run",
    );
    process.exit(1);
  }

  // 3b. Estimate translation work from actual chunk text (titles/URLs are
  //     almost all English even for German documents, so they under-count).
  const samples = await prisma.document.findMany({
    select: { id: true },
    take: Math.min(10, total),
    orderBy: { createdAt: "desc" },
  });
  let germanSample = 0;
  for (const sample of samples) {
    const chunk = await prisma.documentChunk.findFirst({
      where: { documentId: sample.id },
      select: { text: true },
    });
    if (chunk && detectLanguage(chunk.text) === "de") {
      germanSample += 1;
    }
  }
  const germanRatio = samples.length > 0 ? germanSample / samples.length : 0;
  const estimatedGerman = Math.round(total * germanRatio);
  logger.info(
    "[MIGRATE] Est. ~%d/%d documents need translation (sample: %d/%d German)",
    estimatedGerman,
    total,
    germanSample,
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
    embeddingClient,
  };

  logger.info("[MIGRATE] Re-ingesting all documents through the English-first pipeline…");
  logger.info(
    "[MIGRATE] Rate-limiter: keys=%d, concurrency=%d, models=%s, totalTpd=%d/day",
    limiter.size,
    concurrency,
    limiter.modelsList.join(" → "),
    limiter.totalTpd,
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
