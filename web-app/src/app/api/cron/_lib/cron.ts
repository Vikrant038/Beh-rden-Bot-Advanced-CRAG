import { NextResponse } from "next/server";
import { env } from "@/server/env";
import { toErrorMessage } from "@/server/lib/errors";
import { createLogger } from "@/server/lib/logger";

const logger = createLogger("cron");

/**
 * Shared Vercel Cron scaffold: verifies the `Authorization: Bearer <CRON_SECRET>`
 * header, runs the handler, and maps the result/exception onto the standard
 * `{ success, ...payload | error }` JSON envelope the cron tests assert on.
 */
export async function runCron(
  request: Request,
  run: () => Promise<Record<string, unknown>>,
): Promise<NextResponse> {
  const auth = request.headers.get("authorization");
  if (!env.CRON_SECRET || auth !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const payload = await run();
    return NextResponse.json({ success: true, ...payload });
  } catch (error) {
    const message = toErrorMessage(error);
    logger.error({ error: message }, "[CRON] handler failed");
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
