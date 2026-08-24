/**
 * Ingest pipeline: fetch URL → clean → chunk → embed (1024-d BGE-M3) →
 * transactional store in Postgres (pgvector) → invalidate corpus + cache.
 * Ported from `src/ingest.py` + `src/embed.py` (Python reference).
 *
 * ⚠️  BACKPRESSURE LIMITATION:
 * URL ingestion (scrape + embed) runs synchronously inside the calling
 * process. On Vercel serverless a single ingest blocks the function for the
 * full scrape + embedding time (Gemini, ~2–5 s per document) and a full
 * corpus sync would blow the 60 s timeout.
 *
 * Production path: the admin surface does NOT call these functions directly
 * anymore — it enqueues into the background job queue (src/server/ingest/jobs.ts),
 * which the Vercel Cron worker at /api/cron/process-ingest-jobs drains serially
 * (concurrency 1, rate-limit friendly) with retries and lease recovery.
 *
 * The functions below remain the synchronous core used by that worker
 * (`ingestUrl`/`ingestPdf` per job). `syncAllDocuments` + `IngestQueue` are
 * kept as a tested, dependency-free helper for one-off/CLI re-ingests only.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { cleanText } from "@/server/ingest/cleaner";
import { RecursiveChunker, chunkParentChild } from "@/server/ingest/chunker";
import { scrapeWebPage, type ScrapedDocument } from "@/server/ingest/scraper";
import { parsePdf } from "@/server/ingest/pdf-parser";
import { createDefaultEmbeddingClient, type EmbeddingClient } from "@/server/embeddings/client";
import { toVectorLiteral } from "@/server/db/vector-queries";
import { semanticCache } from "@/server/rag/cache/semantic-cache";
import { getCorpusProvider } from "@/server/rag/instance";
import { ExternalApiError } from "@/server/lib/errors";
import { runWithTrace } from "@/server/tracing";
import { createLogger } from "@/server/lib/logger";
import { translateToEnglish, type TranslationRateLimiter } from "@/server/ingest/translate";

const logger = createLogger("ingest");

export type IngestStatus = "created" | "updated" | "skipped" | "failed" | "progress";

export interface IngestResult {
  url: string;
  title: string;
  status: IngestStatus;
  chunkCount: number;
  parentCount?: number;
  hash: string;
  error?: string;
  cacheInvalidated: number;
  /** Next parent-block cursor when `status === "progress"` (resumable ingest). */
  nextBlock?: number;
}

export interface IngestOptions {
  chunker?: RecursiveChunker;
  embeddingClient?: EmbeddingClient;
  /** Re-ingest even when the content hash is unchanged. */
  force?: boolean;
  /**
   * When true, the text is normalized to English before chunking/embedding:
   * non-English documents are translated via Groq (rate-limited). The rate
   * limiter *must* be provided when this is true (shared across pipeline
   * calls so the token bucket is respected globally).
   */
  normalizeEnglish?: boolean;
  /** Groq rate limiter (or multi-key pool) for translation (required when
   * normalizeEnglish is true — shared across pipeline calls so the token
   * buckets are respected globally). */
  rateLimiter?: TranslationRateLimiter;
  /**
   * Optional display-name override. Defaults to the scraped `<title>` for URLs
   * and the filename for PDFs. When provided on a content-unchanged re-ingest,
   * only the stored title is updated (no re-embedding).
   */
  title?: string;
  /**
   * Resumable-ingest cursor (PDF jobs): number of parent blocks already embedded
   * + stored by earlier ticks. Blocks 0..resumeFrom-1 are kept as-is; only the
   * tail is embedded and stored. 0/undefined = start from scratch.
   */
  resumeFrom?: number;
  /**
   * Mid-job budget check (PDF jobs): called after each parent block. When it
   * returns true and blocks remain, ingest yields with `status: "progress"`
   * and `nextBlock` set, so the worker can park the job back on the queue
   * instead of letting the serverless runtime kill it mid-embed.
   */
  isBudgetExhausted?: () => boolean;
}

function hashContent(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function embedChunks(
  embeddingClient: EmbeddingClient,
  chunks: string[],
): Promise<number[][]> {
  if (chunks.length === 0) {
    return [];
  }
  return embeddingClient.embedTexts(chunks);
}

/**
 * Ingests a single URL into the knowledge base. Idempotent: when the fetched
 * content hash matches the stored document, the document is left untouched.
 */
export async function ingestUrl(
  rawUrl: string,
  options: IngestOptions = {},
): Promise<IngestResult> {
  return runWithTrace(
    {
      name: "ingest",
      metadata: { url: rawUrl.trim() },
      input: rawUrl.trim(),
    },
    () => ingestUrlInner(rawUrl, options),
  );
}

async function ingestUrlInner(rawUrl: string, options: IngestOptions = {}): Promise<IngestResult> {
  const url = rawUrl.trim();

  let scraped: ScrapedDocument;
  try {
    scraped = await scrapeWebPage(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ url, error: message }, "[INGEST] scrape failed");
    return {
      url,
      title: "",
      status: "failed",
      chunkCount: 0,
      hash: "",
      error: message,
      cacheInvalidated: 0,
    };
  }

  const titleOverride = options.title?.trim();
  const cleaned = cleanText(scraped.text);
  return persistIngestedWithNormalization(url, titleOverride || scraped.title, cleaned, options);
}

async function persistIngestedWithNormalization(
  sourceKey: string,
  title: string,
  cleaned: string,
  options: IngestOptions = {},
): Promise<IngestResult> {
  const text = options.normalizeEnglish ? await normalizeToEnglish(cleaned, options) : cleaned;
  return persistIngested(sourceKey, title, text, options);
}

/**
 * Translates the text to English if it is not already English, using the
 * Groq rate limiter from options. Returns the (possibly translated) text.
 */
export async function normalizeToEnglish(
  text: string,
  options: IngestOptions = {},
): Promise<string> {
  const limiter = options.rateLimiter;
  if (!limiter) {
    logger.warn(
      "[INGEST] normalizeEnglish requested but no rateLimiter provided — skipping translation",
    );
    return text;
  }
  try {
    const result = await translateToEnglish(text, limiter);
    if (result.translated) {
      logger.info(
        { language: result.language, tokensUsed: result.tokensUsed },
        "[INGEST] translated to English",
      );
    }
    return result.englishText;
  } catch (error) {
    logger.warn({ error: String(error) }, "[INGEST] translation failed — using original text");
    return text;
  }
}

/**
 * Shared persistence tail for URL and PDF ingestion: clean → hash →
 * idempotency check → parent-child chunk → child embed → transactional store →
 * invalidate corpus + semantic cache. True Parent-Child Chunking (§2.5):
 * parents (~2000 ch) are stored for LLM context; children (~200 ch) are embedded
 * for search.
 */
async function persistIngested(
  sourceKey: string,
  title: string,
  cleaned: string,
  options: IngestOptions = {},
): Promise<IngestResult> {
  const embeddingClient = options.embeddingClient ?? createDefaultEmbeddingClient();

  const hash = hashContent(cleaned);
  const existing = await prisma.document.findUnique({ where: { url: sourceKey } });

  const resumeFrom = options.resumeFrom ?? 0;

  // A row with a matching hash but ZERO stored chunks is a broken record (an
  // ingest that died between the upsert and the first successful embed) — it is
  // NOT in sync, so the hash-match skip must not apply. Re-ingesting rebuilds
  // it from the source (this is what the syncAllDocuments CLI hit for
  // pdf://…/englisch_aufenthg.pdf on prod: matching hash + chunkCount 0 +
  // status INGESTING, skipped forever).
  if (
    existing &&
    existing.hash === hash &&
    existing.chunkCount > 0 &&
    !options.force &&
    resumeFrom === 0
  ) {
    // Allow re-titling a document even when its content is unchanged: update
    // the stored title without re-scraping chunks or re-embedding.
    const titleOverride = options.title?.trim();
    if (titleOverride && existing.title !== titleOverride) {
      await prisma.document.update({
        where: { url: sourceKey },
        data: { title: titleOverride },
      });
      // Keep chunk sourceName in sync so chat source citations render the new title.
      await prisma.documentChunk.updateMany({
        where: { documentId: existing.id },
        data: { sourceName: titleOverride },
      });
    }
    // Self-heal a stuck INGESTING flag: content matches what is stored, so the
    // document IS in sync — mark it SYNCED instead of leaving the admin list
    // spinning forever. Only when chunks actually exist (a 0-chunk row with a
    // matching hash is not "synced", it's a broken record).
    if (existing.chunkCount > 0 && existing.status !== "SYNCED") {
      await prisma.document
        .updateMany({
          where: { url: sourceKey },
          data: { status: "SYNCED", lastError: null },
        })
        .catch((error) => {
          logger.warn(
            { url: sourceKey, error: String(error) },
            "[INGEST] self-heal SYNCED update failed",
          );
        });
    }
    logger.info({ url: sourceKey }, "[INGEST] content unchanged; skipping");
    return {
      url: sourceKey,
      title: titleOverride || title,
      status: "skipped",
      chunkCount: existing.chunkCount,
      hash,
      cacheInvalidated: 0,
    };
  }

  const structure = chunkParentChild(cleaned);
  if (structure.length === 0) {
    const message = "No usable chunks extracted from document";
    logger.warn({ url: sourceKey }, `[INGEST] ${message}`);
    return {
      url: sourceKey,
      title,
      status: "failed",
      chunkCount: 0,
      hash,
      error: message,
      cacheInvalidated: 0,
    };
  }

  let documentId: string;
  let childCount = 0;

  if (resumeFrom === 0) {
    const result = await prisma.$transaction(async (tx) => {
      const doc = await tx.document.upsert({
        where: { url: sourceKey },
        create: { url: sourceKey, title, hash, chunkCount: 0, status: "INGESTING" },
        update: { title, hash, chunkCount: 0, status: "INGESTING" },
        select: { id: true },
      });
      if (existing && existing.id !== doc.id) {
        await tx.documentParentChunk.deleteMany({ where: { documentId: existing.id } });
      }
      await tx.documentParentChunk.deleteMany({ where: { documentId: doc.id } });
      return doc;
    });
    documentId = result.id;
  } else {
    if (!existing) {
      throw new Error("Cannot resume: document not found");
    }
    documentId = existing.id;
    childCount = existing.chunkCount;
  }

  for (let i = resumeFrom; i < structure.length; i++) {
    const block = structure[i];
    const childTexts = block.children.map((child) => child.text);

    if (childTexts.length > 0) {
      let vectors: number[][];
      try {
        vectors = await embedChunks(embeddingClient, childTexts);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn({ url: sourceKey, block: i }, `[INGEST] embedding failed: ${message}`);
        // Roll the fresh document back to a RETRYABLE state so a later run
        // re-ingests it instead of skipping: the upsert above stored the new
        // hash with chunkCount 0, so without cleanup the next run would treat
        // it as "content unchanged" and never embed it. Resume attempts
        // (resumeFrom > 0) keep prior committed blocks, so only fresh attempts
        // roll back.
        //
        // We deliberately do NOT `document.delete` here. Deleting the row would
        // CASCADE to its chunks and could race a concurrent in-flight job still
        // mid-loop creating parent chunks for the same documentId → an FK
        // violation on `document_parent_chunks_documentId_fkey` (seen on prod
        // when two sync runs overlap). Keeping the row but resetting it to
        // chunkCount 0 + FAILED is race-safe AND still re-ingests next run: the
        // hash-match skip above requires `chunkCount > 0`, so a 0-chunk row is
        // treated as a broken record and rebuilt.
        if (resumeFrom === 0) {
          try {
            await prisma.documentChunk.deleteMany({ where: { documentId } });
            await prisma.documentParentChunk.deleteMany({ where: { documentId } });
            await prisma.document.update({
              where: { id: documentId },
              data: { chunkCount: 0, status: "FAILED", lastError: message },
            });
          } catch (cleanupError) {
            logger.warn(
              { url: sourceKey, error: String(cleanupError) },
              "[INGEST] failed to clean up partially-created document",
            );
          }
        }
        return {
          url: sourceKey,
          title,
          status: "failed",
          chunkCount: childCount,
          hash,
          error: message,
          cacheInvalidated: 0,
        };
      }

      await prisma.$transaction(async (tx) => {
        const parent = await tx.documentParentChunk.create({
          data: { documentId, text: block.parent.text },
          select: { id: true },
        });

        const rows = block.children.map((child, index) => {
          const vector = vectors[index];
          if (!vector) return null;
          return Prisma.sql`(
            ${documentId},
            ${parent.id},
            ${title},
            ${sourceKey},
            ${child.text},
            ${toVectorLiteral(vector)}::vector,
            ${/[äöüßÄÖÜ]/.test(child.text)},
            NOW()
          )`;
        });

        const nonNull = rows.filter((row): row is Prisma.Sql => row !== null);
        if (nonNull.length > 0) {
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO document_chunks
              ("documentId", "parentId", "sourceName", "sourceUrl", "text", "embedding", "isGerman", "createdAt")
            VALUES ${Prisma.join(nonNull, ", ")}
          `);
          childCount += nonNull.length;
        }

        await tx.document.update({
          where: { id: documentId },
          data: { chunkCount: childCount },
        });
      });
    }

    if (options.isBudgetExhausted?.() && i < structure.length - 1) {
      logger.info({ url: sourceKey, progress: i + 1 }, "[INGEST] budget exhausted, yielding");
      return {
        url: sourceKey,
        title,
        status: "progress",
        chunkCount: childCount,
        hash,
        cacheInvalidated: 0,
        nextBlock: i + 1,
      };
    }
  }

  const invalidated = await semanticCache.invalidateForDocument(documentId);
  await getCorpusProvider().invalidate();

  // Mark the document SYNCED on completion. The job worker (jobs.ts
  // finalizeJob) also does this, but CLI/direct pipeline runs never reach it —
  // without this write the document stays INGESTING forever even though its
  // chunks are stored (the bug that left the whole admin list spinning).
  await prisma.document
    .updateMany({
      where: { id: documentId },
      data: { status: "SYNCED", lastError: null },
    })
    .catch((error) => {
      logger.warn({ documentId, error: String(error) }, "[INGEST] completion SYNCED update failed");
    });

  logger.info(
    { url: sourceKey, status: "updated", chunks: childCount, invalidated },
    "[INGEST] completed",
  );
  return {
    url: sourceKey,
    title,
    status: !existing ? "created" : "updated",
    chunkCount: childCount,
    parentCount: structure.length,
    hash,
    cacheInvalidated: invalidated,
  };
}

/**
 * Ingests a PDF buffer into the knowledge base. Idempotent via a content-hash
 * derived `pdf://` source key. ADMIN-only callers (upload route §2.2.4).
 */
export async function ingestPdf(
  buffer: Buffer,
  filename: string,
  options: IngestOptions = {},
): Promise<IngestResult & { filename: string }> {
  return runWithTrace({ name: "ingest-pdf", metadata: { filename }, input: filename }, async () => {
    const parsed = await parsePdf(buffer);
    const cleaned = cleanText(parsed.text);
    const result = await persistIngestedWithNormalization(
      pdfSourceKey(buffer, filename),
      options.title?.trim() || filename,
      cleaned,
      options,
    );
    return { ...result, filename };
  });
}

/** Deterministic `pdf://<content-hash-prefix>/<sanitized-filename>` source key. */
export function pdfSourceKey(buffer: Buffer, filename: string): string {
  const digest = createHash("sha256").update(buffer).digest("hex").slice(0, 16);
  const safeName = filename.replace(/[^\w.\-]+/g, "_").toLowerCase();
  return `pdf://${digest}/${safeName}`;
}

/** Parses a `pdf://` source key into its SHA-256 prefix and sanitized name. */
export function parsePdfSourceKey(sourceKey: string): { hashPrefix: string; name: string } | null {
  const match = /^pdf:\/\/([0-9a-f]{16})\/(.+)$/.exec(sourceKey);
  if (!match) return null;
  return { hashPrefix: match[1]!, name: match[2]! };
}

/**
 * Directory that holds the source PDFs for `pdf://` documents (overridable
 * via PDFS_DIR for tests). Re-ingests resolve the buffer by matching the
 * SHA-256 prefix stored in the source key.
 */
const PDFS_DIR = process.env.PDFS_DIR ?? join(process.cwd(), "data", "pdfs");

function walkPdfFiles(dir: string): string[] {
  let files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(walkPdfFiles(full));
    } else if (entry.name.toLowerCase().endsWith(".pdf")) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Finds the on-disk PDF buffer for a `pdf://` source key by matching the
 * first-16-hex SHA-256 prefix of the buffer (the same derivation used by
 * `pdfSourceKey`). Returns null when no file under `dir` matches.
 */
export function findPdfBuffer(sourceKey: string, dir: string = PDFS_DIR): Buffer | null {
  const parsed = parsePdfSourceKey(sourceKey);
  if (!parsed) return null;
  let files: string[];
  try {
    files = walkPdfFiles(dir);
  } catch {
    return null;
  }
  for (const file of files) {
    let buffer: Buffer;
    try {
      buffer = readFileSync(file);
    } catch {
      continue;
    }
    const prefix = createHash("sha256").update(buffer).digest("hex").slice(0, 16);
    if (prefix === parsed.hashPrefix) {
      return buffer;
    }
  }
  return null;
}

/**
 * Re-ingests every document currently in the knowledge base using a serial
 * queue (concurrency = 1). Documents whose content hash is unchanged are
 * skipped (idempotent).
 *
 * ⚠️  One-off/CLI helper only — production syncs go through the background
 * job queue (src/server/ingest/jobs.ts → enqueueSyncJobs) drained by the
 * cron worker. See module-level JSDoc.
 */
export async function syncAllDocuments(
  options: IngestOptions = {},
  queueOptions: { concurrency?: number } = {},
): Promise<IngestResult[]> {
  const documents = await prisma.document.findMany({ select: { url: true } });
  const concurrency = Math.max(1, queueOptions.concurrency ?? 1);
  logger.info(
    { count: documents.length, concurrency },
    "[INGEST] starting full sync via serial queue",
  );

  const queue = new IngestQueue({ concurrency });
  const results: IngestResult[] = [];

  for (const document of documents) {
    queue.add(async () => {
      // `pdf://` documents cannot be re-scraped as URLs (the SSRF guard rejects
      // the scheme) — resolve the stored buffer from data/pdfs instead.
      const result = document.url.startsWith("pdf://")
        ? await reingestPdfDocument(document.url, options)
        : await ingestUrl(document.url, options);
      results.push(result);
      logger.info(
        { url: document.url, status: result.status, chunks: result.chunkCount },
        "[INGEST] queue job complete",
      );
    });
  }

  await queue.drain();
  logger.info({ total: results.length }, "[INGEST] full sync complete");
  return results;
}

/**
 * Re-ingests a stored `pdf://` document from its on-disk buffer. Returns a
 * failed result (without touching the document row) when the file is missing
 * so a later run can retry.
 */
async function reingestPdfDocument(
  sourceKey: string,
  options: IngestOptions = {},
): Promise<IngestResult> {
  const parsed = parsePdfSourceKey(sourceKey);
  const buffer = parsed ? findPdfBuffer(sourceKey) : null;
  if (!buffer || !parsed) {
    const message = parsed
      ? `PDF file not found on disk (looked under ${PDFS_DIR})`
      : "Invalid pdf:// source key";
    logger.warn({ url: sourceKey, error: message }, "[INGEST] pdf re-ingest failed");
    return {
      url: sourceKey,
      title: "",
      status: "failed",
      chunkCount: 0,
      hash: "",
      error: message,
      cacheInvalidated: 0,
    };
  }
  return ingestPdf(buffer, parsed.name, options);
}

/**
 * Minimal serial async queue for ingest jobs.
 *
 * Concurrency is configurable (default 1 = strictly serial). Jobs are run
 * in insertion order. `drain()` resolves when every queued job has settled.
 *
 * Why not a library? The project has no existing queue dependency and the
 * Vercel/serverless constraints make a full BullMQ setup disproportionate
 * for the current corpus size. This 40-line class gives the same sequential
 * guarantee and is trivially replaceable.
 */
export class IngestQueue {
  private readonly concurrency: number;
  private running = 0;
  private readonly pending: Array<() => Promise<void>> = [];
  private drainResolvers: Array<() => void> = [];

  constructor(options: { concurrency?: number } = {}) {
    this.concurrency = Math.max(1, options.concurrency ?? 1);
  }

  add(job: () => Promise<void>): void {
    this.pending.push(job);
    void this.tick();
  }

  /** Resolves when all currently queued and running jobs have settled. */
  drain(): Promise<void> {
    if (this.running === 0 && this.pending.length === 0) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.drainResolvers.push(resolve);
    });
  }

  private async tick(): Promise<void> {
    if (this.running >= this.concurrency || this.pending.length === 0) {
      return;
    }
    const job = this.pending.shift();
    if (!job) return;
    this.running++;
    try {
      await job();
    } catch (error) {
      logger.warn({ error: String(error) }, "[INGEST QUEUE] job failed");
    } finally {
      this.running--;
      if (this.running === 0 && this.pending.length === 0) {
        for (const resolve of this.drainResolvers) {
          resolve();
        }
        this.drainResolvers = [];
      }
      void this.tick();
    }
  }
}

export { ExternalApiError };
