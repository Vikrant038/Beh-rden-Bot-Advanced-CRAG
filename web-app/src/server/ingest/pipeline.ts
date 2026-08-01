/**
 * Ingest pipeline: fetch URL → clean → chunk (600/150) → embed (768-d BGE) →
 * transactional store in Postgres (pgvector) → invalidate corpus + cache.
 * Ported from `src/ingest.py` + `src/embed.py` (Python reference).
 */

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { cleanText } from "@/server/ingest/cleaner";
import {
  RecursiveChunker,
  chunkParentChild,
  type ParentChildChunk,
} from "@/server/ingest/chunker";
import { scrapeWebPage, type ScrapedDocument } from "@/server/ingest/scraper";
import { parsePdf } from "@/server/ingest/pdf-parser";
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
  parentCount?: number;
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

  return persistIngested(url, scraped.title, cleanText(scraped.text), options);
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
  const embeddingClient = options.embeddingClient ?? new HfEmbeddingClient();

  const hash = hashContent(cleaned);
  const existing = await prisma.document.findUnique({ where: { url: sourceKey } });

  if (existing && existing.hash === hash && !options.force) {
    logger.info({ url: sourceKey }, "[INGEST] content unchanged; skipping");
    return {
      url: sourceKey,
      title,
      status: "skipped",
      chunkCount: existing.chunkCount,
      hash,
      cacheInvalidated: 0,
    };
  }

  const structure = chunkParentChild(cleaned);
  const childTexts = structure.flatMap((block) => block.children.map((child) => child.text));
  if (childTexts.length === 0) {
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

  let vectors: number[][];
  try {
    vectors = await embedChunks(embeddingClient, childTexts);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ url: sourceKey }, `[INGEST] embedding failed: ${message}`);
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

  const stored = await storeDocument(sourceKey, title, hash, structure, vectors, existing?.id);

  const invalidated = await semanticCache.invalidateForDocument(stored.id);
  await getCorpusProvider().invalidate();

  logger.info(
    { url: sourceKey, status: stored.status, chunks: childTexts.length, invalidated },
    "[INGEST] completed",
  );
  return {
    url: sourceKey,
    title,
    status: stored.status,
    chunkCount: childTexts.length,
    parentCount: stored.parentCount,
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
  return runWithTrace(
    { name: "ingest-pdf", metadata: { filename }, input: filename },
    async () => {
      const parsed = await parsePdf(buffer);
      const cleaned = cleanText(parsed.text);
      const result = await persistIngested(pdfSourceKey(buffer, filename), filename, cleaned, options);
      return { ...result, filename };
    },
  );
}

/** Deterministic `pdf://<content-hash-prefix>/<sanitized-filename>` source key. */
export function pdfSourceKey(buffer: Buffer, filename: string): string {
  const digest = createHash("sha256").update(buffer).digest("hex").slice(0, 16);
  const safeName = filename.replace(/[^\w.\-]+/g, "_").toLowerCase();
  return `pdf://${digest}/${safeName}`;
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
  structure: ParentChildChunk[],
  vectors: number[][],
  existingId?: string,
): Promise<{ id: string; status: "created" | "updated"; parentCount: number; childCount: number }> {
  return prisma.$transaction(async (tx) => {
    const document = await tx.document.upsert({
      where: { url },
      create: { url, title, hash, chunkCount: 0 },
      update: { title, hash },
      select: { id: true },
    });

    if (existingId && existingId !== document.id) {
      // Cascades to children via document_chunks_documentId_fkey.
      await tx.documentParentChunk.deleteMany({ where: { documentId: existingId } });
    }
    await tx.documentParentChunk.deleteMany({ where: { documentId: document.id } });

    let childCount = 0;
    for (const block of structure) {
      const parent = await tx.documentParentChunk.create({
        data: { documentId: document.id, text: block.parent.text },
        select: { id: true },
      });

      const rows = block.children.map((child, index) => {
        const vector = vectors[childCount + index];
        if (!vector) {
          return null;
        }
        return Prisma.sql`(
          ${document.id},
          ${parent.id},
          ${title},
          ${url},
          ${child.text},
          ${`[${vector.join(",")}]`}::vector,
          NOW()
        )`;
      });

      const nonNull = rows.filter((row): row is Prisma.Sql => row !== null);
      if (nonNull.length > 0) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO document_chunks
            ("documentId", "parentId", "sourceName", "sourceUrl", "text", "embedding", "createdAt")
          VALUES ${Prisma.join(nonNull, ", ")}
        `);
      }
      childCount += nonNull.length;
    }

    await tx.document.update({
      where: { id: document.id },
      data: { chunkCount: childCount },
    });

    return {
      id: document.id,
      status: existingId ? "updated" : "created",
      parentCount: structure.length,
      childCount,
    };
  });
}

export { ExternalApiError };
