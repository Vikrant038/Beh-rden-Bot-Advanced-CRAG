import { prisma } from "@/server/db";
import { runCron } from "../_lib/cron";
import { createLogger } from "@/server/lib/logger";

export const runtime = "nodejs";

const logger = createLogger("cron");

/**
 * Vercel Cron — cache TTL cleanup (TASK-039).
 * Deletes expired semantic-cache entries. Guarded by `CRON_SECRET`, which Vercel
 * sends as `Authorization: Bearer <secret>`.
 *
 * Scheduled via `vercel.json` crons (see `web-app/vercel.json`).
 */
export async function GET(request: Request) {
  return runCron(request, async () => {
    const result = await prisma.semanticCacheEntry.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    logger.info({ deleted: result.count }, "[CRON] semantic cache cleanup complete");
    return { deleted: result.count };
  });
}
