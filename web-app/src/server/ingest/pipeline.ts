/**
 * Ingest pipeline: fetch URL → clean → chunk (600/150) → embed (768-d BGE) →
 * transactional store in Postgres (pgvector) → invalidate corpus + cache.
 * Ported from `src/ingest.py` + `src/embed.py` (Python reference).
 */

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { cleanText } from "@/server/ingest/cleaner";
import { RecursiveChunker } from "@/server/ingest/chunker";
import { scrapeWebPage, type ScrapedDocument } from "@/server/ingest/scraper";
import { HfEmbeddingClient, type EmbeddingClient } from "@/server/embeddings/client";
import { semanticCache } from "@/server/rag/cache/semantic-cache";
import { getCorpusProvider } from "@/server/rag/instance";
import { ExternalApiError } from "@/server/lib/errors";
import { runWithTrace } from "@/server/tracing";
import { createLogger } from "@/server/lib/logger";

const logger = createLogger("ingest");

export type IngestStatus = "created" | "updated" | "skipped" | "failed";

export interface IngestResult {
  url: string;
  title: string;
  status: IngestStatus;
  chunkCount: number;
  hash: string;
  error?: string;
  cacheInvalidated: number;
}

export interface IngestOptions {
  chunker?: RecursiveChunker;
  embeddingClient?: EmbeddingClient;
  /** Re-ingest even when the content hash is unchanged. */
  force?: boolean;
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
  const chunker = options.chunker ?? new RecursiveChunker();
  const embeddingClient = options.embeddingClient ?? new HfEmbeddingClient();

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

  const cleaned = cleanText(scraped.text);
  const hash = hashContent(cleaned);
  const existing = await prisma.document.findUnique({ where: { url } });

  if (existing && existing.hash === hash && !options.force) {
    logger.info({ url }, "[INGEST] content unchanged; skipping");
    return {
      url,
      title: scraped.title,
      status: "skipped",
      chunkCount: existing.chunkCount,
      hash,
      cacheInvalidated: 0,
    };
  }

  const chunkTexts = chunker.splitText(cleaned);
  if (chunkTexts.length === 0) {
    const message = "No usable chunks extracted from document";
    logger.warn({ url }, `[INGEST] ${message}`);
    return {
      url,
      title: scraped.title,
      status: "failed",
      chunkCount: 0,
      hash,
      error: message,
      cacheInvalidated: 0,
    };
  }

  let vectors: number[][];
  try {
    vectors = await embedChunks(embeddingClient, chunkTexts);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ url }, `[INGEST] embedding failed: ${message}`);
    return {
      url,
      title: scraped.title,
      status: "failed",
      chunkCount: 0,
      hash,
      error: message,
      cacheInvalidated: 0,
    };
  }

  const stored = await storeDocument(url, scraped.title, hash, chunkTexts, vectors, existing?.id);

  const invalidated = await semanticCache.invalidateForDocument(stored.id);
  await getCorpusProvider().invalidate();

  logger.info(
    { url, status: stored.status, chunks: chunkTexts.length, invalidated },
    "[INGEST] completed",
  );
  return {
    url,
    title: scraped.title,
    status: stored.status,
    chunkCount: chunkTexts.length,
    hash,
    cacheInvalidated: invalidated,
  };
}

/**
 * Re-ingests every document currently in the knowledge base. Documents whose
 * content hash is unchanged are skipped (idempotent).
 */
export async function syncAllDocuments(options: IngestOptions = {}): Promise<IngestResult[]> {
  const documents = await prisma.document.findMany({ select: { url: true } });
  logger.info({ count: documents.length }, "[INGEST] starting full sync");
  const results: IngestResult[] = [];
  for (const document of documents) {
    results.push(await ingestUrl(document.url, options));
  }
  return results;
}

async function storeDocument(
  url: string,
  title: string,
  hash: string,
  chunkTexts: string[],
  vectors: number[][],
  existingId?: string,
): Promise<{ id: string; status: "created" | "updated" }> {
  return prisma.$transaction(async (tx) => {
    const document = await tx.document.upsert({
      where: { url },
      create: { url, title, hash, chunkCount: 0 },
      update: { title, hash },
      select: { id: true },
    });

    if (existingId && existingId !== document.id) {
      await tx.documentChunk.deleteMany({ where: { documentId: existingId } });
    }
    await tx.documentChunk.deleteMany({ where: { documentId: document.id } });

    if (chunkTexts.length > 0) {
      const rows = chunkTexts.map(
        (text, index) =>
          Prisma.sql`(
          ${document.id},
          ${title},
          ${url},
          ${text},
          ${`[${vectors[index].join(",")}]`}::vector,
          NOW()
        )`,
      );
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO document_chunks ("documentId", "sourceName", "sourceUrl", "text", "embedding", "createdAt")
        VALUES ${Prisma.join(rows, ", ")}
      `);
    }

    await tx.document.update({
      where: { id: document.id },
      data: { chunkCount: chunkTexts.length },
    });

    return { id: document.id, status: existingId ? "updated" : "created" };
  });
}

export { ExternalApiError };
