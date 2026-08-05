import { z } from "zod";
import { router, protectedProcedure } from "@/server/trpc/t";
import { prisma } from "@/server/db";
import { NotFoundError } from "@/server/lib/errors";

const paginationSchema = z.object({
  cursor: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

export interface SourceListItem {
  id: string;
  title: string;
  url: string;
  chunkCount: number;
  /** Real ingest state (SYNCED/INGESTING/FAILED) maintained by the job worker. */
  status: "PENDING" | "INGESTING" | "SYNCED" | "FAILED";
  updatedAt: Date;
  createdAt: Date;
}

export interface SourceChunkItem {
  id: number;
  sourceName: string;
  sourceUrl: string;
  text: string;
  createdAt: Date;
}

export const sourceRouter = router({
  list: protectedProcedure.query(async (): Promise<SourceListItem[]> => {
    const rows = await prisma.document.findMany({
      select: {
        id: true,
        title: true,
        url: true,
        chunkCount: true,
        status: true,
        updatedAt: true,
        createdAt: true,
      },
      orderBy: { updatedAt: "desc" },
    });
    return rows;
  }),

  getChunks: protectedProcedure
    .input(paginationSchema.extend({ documentId: z.string().min(1) }))
    .query(async ({ input }) => {
      const document = await prisma.document.findUnique({
        where: { id: input.documentId },
        select: { id: true },
      });
      if (!document) {
        throw new NotFoundError("Document", input.documentId);
      }

      const limit = input.limit + 1;
      const rows = await prisma.documentChunk.findMany({
        where: { documentId: input.documentId },
        orderBy: { id: "asc" },
        take: limit,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        select: { id: true, sourceName: true, sourceUrl: true, text: true, createdAt: true },
      });

      const items: SourceChunkItem[] = rows.slice(0, input.limit);
      const nextCursor = rows.length > input.limit ? rows[input.limit]?.id : undefined;
      return { items, nextCursor: nextCursor ?? null };
    }),

  stats: protectedProcedure.query(async () => {
    const [totalSources, totalChunks, statusGroups] = await Promise.all([
      prisma.document.count(),
      prisma.documentChunk.count(),
      prisma.document.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
    ]);
    const synced = statusGroups.find((g) => g.status === "SYNCED")?._count._all ?? 0;
    const failed = statusGroups.find((g) => g.status === "FAILED")?._count._all ?? 0;
    const pending =
      statusGroups.find((g) => g.status === "PENDING" || g.status === "INGESTING")?._count._all ??
      0;
    return {
      totalSources,
      totalChunks,
      syncedSources: synced,
      failedSources: failed,
      pendingSources: pending,
    };
  }),

  searchChunks: protectedProcedure
    .input(
      z.object({
        query: z.string().trim().min(1).max(200),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(async ({ input }) => {
      const chunks = await prisma.documentChunk.findMany({
        where: {
          text: { contains: input.query, mode: "insensitive" },
        },
        take: input.limit,
        select: { id: true, sourceName: true, sourceUrl: true, text: true, createdAt: true },
      });
      return { items: chunks };
    }),
});
