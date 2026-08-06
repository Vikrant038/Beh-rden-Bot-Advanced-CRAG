import { router, publicProcedure } from "@/server/trpc/t";
import { prisma } from "@/server/db";

/**
 * Public, read-only corpus statistics for the landing page.
 *
 * Everything here is derived from the live database — the landing page renders
 * these numbers instead of hardcoded claims. Only aggregate counts are exposed
 * (no chunk text, no user data), so this is safe as a public procedure. The
 * counts are already cached by the tRPC/React-Query client, and a single
 * `count()` is a cheap index scan, so no extra server-side cache is needed.
 */
export const publicRouter = router({
  corpusStats: publicProcedure.query(async () => {
    const [sources, chunks, parentChunks, germanCount, topSources] = await Promise.all([
      prisma.document.count(),
      prisma.documentChunk.count(),
      prisma.documentParentChunk.count(),
      prisma.$queryRaw<{ german: bigint; total: bigint }[]>`
        SELECT
          count(*) FILTER (WHERE text ~ '[äöüßÄÖÜ]') AS german,
          count(*) AS total
        FROM document_chunks;
      `,
      prisma.document.findMany({
        where: { chunkCount: { gt: 0 } },
        orderBy: { chunkCount: "desc" },
        take: 6,
        select: { title: true, chunkCount: true },
      }),
    ]);

    const german = Number(germanCount[0]?.german ?? 0);
    const total = Number(germanCount[0]?.total ?? 0);
    const germanChunkPercent = total > 0 ? Math.round((german / total) * 1000) / 10 : 0;

    return {
      sources,
      chunks,
      parentChunks,
      germanChunkPercent,
      topSources: topSources.map((s) => ({ title: s.title, chunkCount: s.chunkCount })),
    };
  }),
});
