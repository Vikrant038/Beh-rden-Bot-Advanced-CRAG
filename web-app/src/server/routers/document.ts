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
});
