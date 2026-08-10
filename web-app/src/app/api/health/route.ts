import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { createLogger } from "@/server/lib/logger";

const logger = createLogger("health");

export const runtime = "nodejs";

/**
 * Liveness probe — cheap DB round-trip only.
 *
 * This endpoint used to run a full agentic RAG turn ("hi") on every check,
 * which meant several sequential LLM calls (and a possible web search) per
 * request — expensive and noisy for something load balancers hit constantly.
 *
 * A `SELECT 1` confirms the app runtime, the Prisma pool, and Postgres are
 * reachable, which is what a liveness check needs. End-to-end pipeline
 * diagnostics belong in the admin pipeline tester, not here.
 */
export async function GET() {
  const startedAt = Date.now();
  try {
    const rows = await prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok`;
    const ok = rows[0]?.ok === 1;
    if (!ok) {
      throw new Error("DB ping returned an unexpected result");
    }
    return NextResponse.json({
      success: true,
      db: "ok",
      latencyMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    // Only a generic message goes to the public response. The full error
    // (message, cause, stack) is logged server-side — exposing it here leaks
    // internal paths/connection details to anyone who can reach /api/health.
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    logger.error({ error: message, stack }, "[HEALTH] DB ping failed");
    return NextResponse.json(
      {
        success: false,
        db: "error",
        error: message,
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
