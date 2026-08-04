import { z } from "zod";
import { router, adminProcedure } from "@/server/trpc/t";
import { prisma } from "@/server/db";
import { semanticCache } from "@/server/rag/cache/semantic-cache";
import { getCorpusProvider } from "@/server/rag/instance";
import { ingestUrl, syncAllDocuments, type IngestResult } from "@/server/ingest/pipeline";
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

  sync: adminProcedure
    .input(z.object({ force: z.boolean().default(false) }))
    .mutation(async ({ input }): Promise<{ results: IngestResult[]; failed: number }> => {
      const results = await syncAllDocuments({ force: input.force });
      const failed = results.filter((result) => result.status === "failed").length;
      logger.info({ total: results.length, failed }, "[DOCUMENT] sync complete");
      return { results, failed };
    }),

  ingestUrl: adminProcedure
    .input(z.object({ url: z.string().url() }))
    .mutation(async ({ input }): Promise<IngestResult> => {
      await assertSafeUrl(input.url);
      const result = await ingestUrl(input.url);
      logger.info({ url: input.url, status: result.status }, "[DOCUMENT] ingest complete");
      return result;
    }),

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
