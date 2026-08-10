import { router, publicProcedure } from "@/server/trpc/t";
import { prisma } from "@/server/db";
import { germanChunkStats } from "@/server/db/analytics";
import type { Context } from "@/server/trpc/context";

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
  /**
   * Whether this device already holds a valid guest identity (signed
   * `behoerden_guest` cookie, no real session). The login page uses this to
   * route a returning guest straight to /chat instead of making them click
   * "Continue as guest" again — the cookie id is reused (see POST /api/guest),
   * so the guest's prompt-count cap survives refreshes.
   */
  guestStatus: publicProcedure.query(async ({ ctx }) => {
    const { guestId } = ctx as Context;
    return { hasGuest: Boolean(guestId) };
  }),

  corpusStats: publicProcedure.query(async () => {
    const [sources, chunks, parentChunks, germanCount, topSources] = await Promise.all([
      prisma.document.count(),
      prisma.documentChunk.count(),
      prisma.documentParentChunk.count(),
      germanChunkStats(prisma),
      prisma.document.findMany({
        where: { chunkCount: { gt: 0 } },
        orderBy: { chunkCount: "desc" },
        take: 6,
        select: { title: true, chunkCount: true },
      }),
    ]);

    const { german, total } = germanCount;
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
