import { z } from "zod";
import { router, adminProcedure } from "@/server/trpc/t";
import { prisma } from "@/server/db";
import { semanticCache } from "@/server/rag/cache/semantic-cache";
import { getCorpusProvider } from "@/server/rag/instance";
import { enqueueUrlJob, enqueueSyncJobs, getJob, getJobStats } from "@/server/ingest/jobs";
import { assertSafeUrl } from "@/server/lib/security/url-validator";
import { NotFoundError } from "@/server/lib/errors";
import { createLogger } from "@/server/lib/logger";

const logger = createLogger("document-router");

export const documentRouter = router({
  delete: adminProcedure.input(z.object({ id: z.string().min(1) })).mutation(async ({ input }) => {
    const document = await prisma.document.findUnique({
      where: { id: input.id },
      select: { id: true, title: true, chunkCount: true },
    });
    if (!document) {
      throw new NotFoundError("Document", input.id);
    }

    await prisma.document.delete({ where: { id: input.id } });
    const invalidated = await semanticCache.invalidateForDocument(input.id);
    await getCorpusProvider().invalidate();

    logger.info(
      { documentId: input.id, invalidated },
      "[DOCUMENT] deleted document and invalidated cache",
    );

    return { success: true, deletedChunks: document.chunkCount, cacheInvalidated: invalidated };
  }),

  /**
   * Re-ingest every document in the knowledge base. Enqueues one URL job per
   * document (deduped against already-pending jobs); the cron worker drains
   * the queue, so this mutation returns in milliseconds.
   */
  sync: adminProcedure
    .input(z.object({ force: z.boolean().default(false) }))
    .mutation(async ({ input }) => {
      const { enqueued, alreadyPending } = await enqueueSyncJobs({ force: input.force });
      logger.info({ enqueued, alreadyPending }, "[DOCUMENT] sync jobs enqueued");
      return { enqueued, alreadyPending };
    }),

  /**
   * Enqueue a URL for background ingestion. SSRF validation still happens at
   * enqueue time; the actual scrape/embed runs in the cron worker.
   */
  ingestUrl: adminProcedure
    .input(
      z.object({
        url: z.string().url(),
        /** Optional display-name override; defaults to the scraped page title. */
        title: z.string().trim().max(200).optional(),
      }),
    )
    .mutation(async ({ input }): Promise<{ jobId: string; queued: boolean }> => {
      await assertSafeUrl(input.url);
      const result = await enqueueUrlJob(input.url, { title: input.title });
      logger.info({ url: input.url, jobId: result.jobId }, "[DOCUMENT] URL ingest job enqueued");
      return result;
    }),

  /** Poll a single ingest job (admin UI progress). */
  jobGet: adminProcedure.input(z.object({ id: z.string().min(1) })).query(async ({ input }) => {
    const job = await getJob(input.id);
    if (!job) {
      throw new NotFoundError("IngestJob", input.id);
    }
    return job;
  }),

  /** Queue depth for the admin UI (sync-all progress). */
  jobStats: adminProcedure.query(async () => getJobStats()),

  deleteMany: adminProcedure
    .input(z.object({ ids: z.array(z.string().min(1)).min(1).max(100) }))
    .mutation(async ({ input }) => {
      const docs = await prisma.document.findMany({
        where: { id: { in: input.ids } },
        select: { id: true, chunkCount: true },
      });
      const ids = docs.map((doc) => doc.id);
      const totalChunks = docs.reduce((acc, doc) => acc + doc.chunkCount, 0);

      if (ids.length > 0) {
        await prisma.document.deleteMany({ where: { id: { in: ids } } });
        for (const id of ids) {
          await semanticCache.invalidateForDocument(id);
        }
        await getCorpusProvider().invalidate();
      }

      logger.info({ deleted: ids.length, totalChunks }, "[DOCUMENT] bulk deleted documents");
      return { success: true, deletedCount: ids.length, deletedChunks: totalChunks };
    }),
});
