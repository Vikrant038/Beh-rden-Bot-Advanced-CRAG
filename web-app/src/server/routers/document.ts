import { z } from "zod";
import { router, adminProcedure } from "@/server/trpc/t";
import { prisma } from "@/server/db";
import { semanticCache } from "@/server/rag/cache/semantic-cache";
import { getCorpusProvider } from "@/server/rag/instance";
import { NotFoundError, ValidationError } from "@/server/lib/errors";
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

  sync: adminProcedure.input(z.object({ url: z.string().url().optional() })).mutation(async () => {
    throw new ValidationError(
      "sync",
      "document sync is provided by the admin data-pipeline update (Phase D)",
    );
  }),

  ingestUrl: adminProcedure.input(z.object({ url: z.string().url() })).mutation(async () => {
    throw new ValidationError(
      "ingestUrl",
      "URL ingestion is provided by the admin data-pipeline update (Phase D)",
    );
  }),
});
