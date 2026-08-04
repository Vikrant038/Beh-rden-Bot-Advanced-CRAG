import { NextResponse } from "next/server";
import { env } from "@/server/env";
import { processIngestJobs } from "@/server/ingest/jobs";
import { createLogger } from "@/server/lib/logger";

export const runtime = "nodejs";
// Stay well under the serverless cap: the worker enforces its own 50 s budget.
export const maxDuration = 60;

const logger = createLogger("cron");

/**
 * Vercel Cron — drains the background ingest job queue (see
 * src/server/ingest/jobs.ts). Guarded by `CRON_SECRET` (Vercel sends it as
 * `Authorization: Bearer <secret>`), same pattern as /api/cron/cleanup-cache.
 *
 * Scheduled via `vercel.json` — note the plan caveat: Vercel Hobby allows a
 * single daily cron, so this needs the Pro plan (per-minute crons) for fast
 * ingestion; the route itself also works when hit manually or via `vercel dev`.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const auth = request.headers.get("authorization");
  if (!env.CRON_SECRET || auth !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await processIngestJobs();
    logger.info(result, "[CRON] ingest jobs processed");
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, "[CRON] ingest job processing failed");
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
