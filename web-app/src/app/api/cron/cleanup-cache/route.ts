import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
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
export async function GET(request: Request): Promise<NextResponse> {
  const auth = request.headers.get("authorization");
  if (!env.CRON_SECRET || auth !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();
    const result = await prisma.semanticCacheEntry.deleteMany({
      where: { expiresAt: { lt: now } },
    });
    logger.info({ deleted: result.count }, "[CRON] semantic cache cleanup complete");
    return NextResponse.json({ success: true, deleted: result.count });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, "[CRON] cache cleanup failed");
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
