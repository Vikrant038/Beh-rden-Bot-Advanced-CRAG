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
 * On Vercel Hobby (daily crons only), the five-minute schedule is NOT
 * registered in `vercel.json` — the admin UI's poll loop
 * (`document.jobGet`/`jobStats`) calls `drainPendingJobs()` instead, so
 * ingestion works without a timer. This route remains as the Pro-plan path
 * (per-minute cron) and for manual triggering (e.g. an external scheduler
 * hitting it with `CRON_SECRET`).
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
