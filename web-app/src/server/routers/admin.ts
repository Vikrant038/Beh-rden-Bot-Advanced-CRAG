import { router, adminProcedure } from "@/server/trpc/t";
import { after } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import {
  EXCLUDE_GUESTS_WHERE,
  dailyQueries,
  failedQueries,
  messageStats,
  modeSplit,
  recentQueries,
  topQuestions,
} from "@/server/db/analytics";
import { semanticCache } from "@/server/rag/cache/semantic-cache";
import { createLogger } from "@/server/lib/logger";
import { NotFoundError } from "@/server/lib/errors";
import { z } from "zod";
import { runAgenticRag } from "@/server/rag/agents/orchestrator";
import { runStandardCrag, type StandardRagTrace } from "@/server/rag/pipeline";
import { isQueryOutOfDomain, OUT_OF_DOMAIN_MESSAGE } from "@/server/rag/guardrail";
import { getHybridRetriever } from "@/server/rag/instance";
import { runStageZero } from "@/server/rag/stage-zero";

const logger = createLogger("admin-router");

export interface AdminMetrics {
  totalUsers: number;
  totalConversations: number;
  totalMessages: number;
  queriesToday: number;
  cacheHitRate: number;
  avgLatencyMs: number;
  documentCount: number;
}

export interface AdminUserRow {
  id: string;
  name: string | null;
  email: string;
  role: "USER" | "ADMIN";
  createdAt: Date;
  conversationCount: number;
}

export interface DailyQueryPoint {
  date: string;
  count: number;
}

export interface ModeSplitPoint {
  mode: string;
  count: number;
}

export interface RecentQueryRow {
  id: string;
  conversationId: string;
  query: string;
  createdAt: Date;
  mode: string;
  latencyMs: number;
  isCached: boolean;
  retrievalPath: string | null;
}

export type RecentQueriesCursor = { createdAt: Date; id: string };

export interface PipelineRunListItem {
  id: string;
  prompt: string;
  latencyMs: number;
  status: "RUNNING" | "SUCCESS" | "FAILED";
  error: string | null;
  createdAt: Date;
}

const DAILY_QUERY_MAX_DAYS = 90;

const RECENT_QUERY_LIMIT = 10;

/**
 * In-memory memory adapter for `admin.testPipeline`: prevents the orchestrator's
 * `memory.addTurn()` from upserting a ConversationMemory row whose conversationId
 * FK would not exist in the DB. Side-effect-free, so a glass-box run never writes.
 */
class NoopMemory {
  async ensureLoaded(): Promise<void> {}
  async addTurn(): Promise<void> {}
  async getContextFormatted(): Promise<string> {
    return "";
  }
  async clear(): Promise<void> {}
}

/**
 * Serializes a pipeline failure for the admin-only Developer mode surface:
 * error class, raw message, `cause`, and the stack trace. Safe here because the
 * pipeline tester is behind the ADMIN role gate — end-user chat errors never
 * flow through this path.
 */
export function formatDebugError(error: unknown): string {
  if (error instanceof Error) {
    const cause =
      error.cause instanceof Error
        ? `${error.cause.name}: ${error.cause.message}`
        : error.cause !== undefined
          ? String(error.cause)
          : "none";
    return [
      `[${error.name}] ${error.message}`,
      `Cause: ${cause}`,
      `Stack:`,
      error.stack ?? "(no stack captured)",
    ].join("\n");
  }
  return `[UnknownError] ${String(error)}`;
}

/**
 * Keeps only the most recent MAX_PIPELINE_RUNS pipeline-test runs, deleting
 * older rows so the admin tester never accumulates unbounded traceJson
 * history. RUNNING rows are always preserved — the tester UI may still be
 * polling them — so pruning runs after a terminal state is persisted.
 */
const MAX_PIPELINE_RUNS = 5;

/**
 * Deletes pipeline-run history beyond the newest MAX_PIPELINE_RUNS terminal
 * runs. Best-effort: failures are swallowed (the pipeline itself has already
 * completed; a prune error must not change its outcome).
 */
async function prunePipelineRuns(): Promise<void> {
  const recent = await prisma.pipelineRun.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MAX_PIPELINE_RUNS,
    select: { id: true },
  });
  const keepIds = recent.map((row) => row.id);
  if (keepIds.length === 0) return;
  await prisma.pipelineRun.deleteMany({
    where: { id: { notIn: keepIds }, status: { not: "RUNNING" } },
  });
}

/**
 * Runs a single glass-box pipeline test in the background and records the
 * outcome on its PipelineRun row. The HTTP request returns the runId in ~100ms
 * (see `testPipeline`); this worker — scheduled via `after()` — does the real
 * 15–38s of LLM work after the response is flushed, so the request never
 * outlives the serverless function ceiling.
 *
 * Exported separately so unit tests can exercise the full SUCCESS/FAILED
 * persistence contract without driving `after()`.
 */
export async function executePipelineTest(
  runId: string,
  input: {
    prompt: string;
    bypassCache: boolean;
    debug: boolean;
    pipeline?: "agentic" | "standard";
  },
): Promise<void> {
  const startedAt = Date.now();
  const pipeline = input.pipeline ?? "agentic";
  try {
    // Stage 0 — run PII mask + disambiguation up front (same as the chat
    // pipeline) so the stored trace renders the disambiguation node in the
    // visualizer. The pipeline still runs to completion; ambiguity is
    // recorded, not short-circuited, so the glass-box trace is complete. The
    // masked query is handed to the pipeline so it never masks twice.
    const { maskedQuery, disambiguation } = await runStageZero(input.prompt);

    let traceJson: unknown;
    let latencyMs: number;
    if (pipeline === "standard") {
      // Standard CRAG path — mirror the chat stream: domain guardrail at entry
      // (CRAG itself is guardrail-free), then the single-shot corrected-RAG
      // pipeline with per-stage trace collection for the visualizer.
      const t0 = Date.now();
      const blocked = await isQueryOutOfDomain(maskedQuery);
      const guardrailDurationMs = Date.now() - t0;
      const result = await runStandardCrag(input.prompt, {
        hybridRetriever: getHybridRetriever(),
        cache: semanticCache,
        memory: new NoopMemory(),
        bypassCache: input.bypassCache,
        maskedQuery,
        collectTrace: true,
      });
      const core = result.trace;
      const trace: StandardRagTrace = {
        pipeline: "standard",
        userQuery: input.prompt,
        maskedQuery,
        guardrail: {
          passed: !blocked,
          reason: blocked ? OUT_OF_DOMAIN_MESSAGE : undefined,
          durationMs: guardrailDurationMs,
        },
        finalAnswer: result.answer,
        sources: result.sources,
        retrievalPath: result.retrievalPath,
        isGrounded: result.isGrounded,
        isCached: result.isCached,
        disambiguation,
        retrievalTelemetry: core?.retrievalTelemetry,
        totalLatencyMs: core?.totalLatencyMs ?? result.latencyMs,
        stages: core?.stages ?? [],
        llmCalls: core?.llmCalls ?? [],
        totalCostUsd: core?.totalCostUsd ?? 0,
        preProcessing: core?.preProcessing,
        postProcessing: core?.postProcessing,
      };
      traceJson = trace;
      latencyMs = trace.totalLatencyMs;
    } else {
      const result = await runAgenticRag(input.prompt, {
        hybridRetriever: getHybridRetriever(),
        cache: semanticCache,
        memory: new NoopMemory(),
        bypassCache: input.bypassCache,
        maskedQuery,
        disambiguation,
      });
      traceJson = result;
      latencyMs = result.totalLatencyMs;
    }

    await prisma.pipelineRun
      .update({
        where: { id: runId },
        data: {
          traceJson: traceJson as Prisma.InputJsonValue,
          latencyMs,
          status: "SUCCESS",
          error: null,
        },
      })
      .catch((persistError) => {
        logger.warn(
          { error: String(persistError) },
          "[ADMIN] failed to persist successful pipeline run",
        );
      });
    logger.info(
      { runId, prompt: input.prompt, pipeline, latencyMs },
      "[ADMIN] pipeline test complete",
    );
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const detail = input.debug
      ? formatDebugError(error)
      : error instanceof Error
        ? error.message
        : String(error);
    await prisma.pipelineRun
      .update({
        where: { id: runId },
        data: {
          traceJson: {},
          latencyMs,
          status: "FAILED",
          error: detail.slice(0, 2000),
        },
      })
      .catch((persistError) => {
        logger.warn(
          { error: String(persistError) },
          "[ADMIN] failed to persist failed pipeline run",
        );
      });
    logger.warn(
      { runId, prompt: input.prompt, latencyMs, debug: input.debug },
      "[ADMIN] pipeline test failed",
    );
  } finally {
    // Keep only the newest MAX_PIPELINE_RUNS terminal runs on disk; older
    // traceJson blobs are deleted best-effort so the table stays bounded.
    await prunePipelineRuns().catch((error) => {
      logger.warn({ error: String(error) }, "[ADMIN] failed to prune old pipeline runs");
    });
  }
}

export const adminRouter = router({
  metrics: adminProcedure
    .input(
      z
        .object({
          days: z.number().int().min(1).max(DAILY_QUERY_MAX_DAYS).optional(),
        })
        .optional(),
    )
    .query(async ({ input }): Promise<AdminMetrics> => {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const days = input?.days;

      const [totalUsers, totalConversations, totalMessages, queriesToday, documentCount, stats] =
        await Promise.all([
          prisma.user.count({ where: EXCLUDE_GUESTS_WHERE }).catch((error) => {
            logger.warn({ error: String(error) }, "[ADMIN] user.count failed");
            return 0;
          }),
          prisma.conversation.count().catch((error) => {
            logger.warn({ error: String(error) }, "[ADMIN] conversation.count failed");
            return 0;
          }),
          prisma.message.count().catch((error) => {
            logger.warn({ error: String(error) }, "[ADMIN] message.count failed");
            return 0;
          }),
          prisma.message
            .count({ where: { role: "USER", createdAt: { gte: startOfToday } } })
            .catch((error) => {
              logger.warn({ error: String(error) }, "[ADMIN] queriesToday.count failed");
              return 0;
            }),
          prisma.document.count().catch((error) => {
            logger.warn({ error: String(error) }, "[ADMIN] document.count failed");
            return 0;
          }),
          messageStats(prisma, days).catch((error) => {
            logger.warn({ error: String(error) }, "[ADMIN] message stats aggregation failed");
            return undefined;
          }),
        ]);

      const assistantCount = stats?.assistantCount ?? 0;
      const cacheHits = stats?.cacheHits ?? 0;
      const avgLatencyMs = stats?.avgLatencyMs ?? 0;

      return {
        totalUsers,
        totalConversations,
        totalMessages,
        queriesToday,
        cacheHitRate: assistantCount > 0 ? cacheHits / assistantCount : 0,
        avgLatencyMs: Number.isFinite(avgLatencyMs) ? avgLatencyMs : 0,
        documentCount,
      };
    }),

  clearCache: adminProcedure.mutation(async () => {
    const cleared = await semanticCache.clearAll();
    logger.info("[ADMIN] semantic cache cleared");
    return { cleared };
  }),

  users: adminProcedure.query(async (): Promise<AdminUserRow[]> => {
    const rows = await prisma.user.findMany({
      where: EXCLUDE_GUESTS_WHERE,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        _count: { select: { conversations: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    });

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      createdAt: row.createdAt,
      conversationCount: row._count.conversations,
    }));
  }),

  dailyQueries: adminProcedure
    .input(z.object({ days: z.number().int().min(7).max(DAILY_QUERY_MAX_DAYS).default(14) }))
    .query(async ({ input }): Promise<DailyQueryPoint[]> => {
      return dailyQueries(prisma, input.days).catch((error) => {
        logger.warn({ error: String(error) }, "[ADMIN] dailyQueries aggregation failed");
        return [];
      });
    }),

  modeSplit: adminProcedure
    .input(
      z
        .object({
          days: z.number().int().min(1).max(DAILY_QUERY_MAX_DAYS).optional(),
        })
        .optional(),
    )
    .query(async ({ input }): Promise<ModeSplitPoint[]> => {
      const days = input?.days;
      return modeSplit(prisma, days).catch((error) => {
        logger.warn({ error: String(error) }, "[ADMIN] modeSplit aggregation failed");
        return [];
      });
    }),

  recentQueries: adminProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).default(10),
          days: z.number().int().min(1).max(DAILY_QUERY_MAX_DAYS).optional(),
          cursor: z.object({ createdAt: z.coerce.date(), id: z.string().min(1) }).optional(),
        })
        .optional(),
    )
    .query(
      async ({
        input,
      }): Promise<{
        items: RecentQueryRow[];
        nextCursor: RecentQueriesCursor | null;
      }> => {
        const limit = input?.limit ?? RECENT_QUERY_LIMIT;
        const days = input?.days;
        const cursor = input?.cursor;
        return recentQueries(prisma, { limit, days, cursor }).catch((error) => {
          logger.warn({ error: String(error) }, "[ADMIN] recentQueries aggregation failed");
          return { items: [], nextCursor: null };
        });
      },
    ),

  topQuestions: adminProcedure
    .input(z.object({ days: z.number().int().min(1).max(DAILY_QUERY_MAX_DAYS).default(30) }))
    .query(async ({ input }): Promise<Array<{ query: string; count: number }>> => {
      return topQuestions(prisma, input.days).catch((error) => {
        logger.warn({ error: String(error) }, "[ADMIN] topQuestions aggregation failed");
        return [];
      });
    }),

  failedQueries: adminProcedure
    .input(
      z
        .object({
          days: z.number().int().min(1).max(DAILY_QUERY_MAX_DAYS).default(14),
          limit: z.number().int().min(1).max(100).default(10),
        })
        .optional(),
    )
    .query(
      async ({
        input,
      }): Promise<
        Array<{ id: string; conversationId: string; query: string; createdAt: Date }>
      > => {
        const days = input?.days ?? 14;
        const limit = input?.limit ?? 10;
        return failedQueries(prisma, { days, limit }).catch((error) => {
          logger.warn({ error: String(error) }, "[ADMIN] failedQueries aggregation failed");
          return [];
        });
      },
    ),

  queryDetail: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ input }) => {
      const message = await prisma.message.findUnique({
        where: { id: input.id },
        include: {
          conversation: {
            select: { id: true, title: true, mode: true, user: { select: { email: true } } },
          },
        },
      });
      if (!message) {
        throw new Error(`Message not found: ${input.id}`);
      }
      const assistantResponse = await prisma.message.findFirst({
        where: {
          conversationId: message.conversationId,
          role: "ASSISTANT",
          createdAt: { gte: message.createdAt },
        },
        orderBy: { createdAt: "asc" },
      });
      // Map Json columns to `unknown` so the tRPC client type does not carry the
      // deeply-recursive Prisma JsonValue union (TS2589) — consumers cast the
      // metadata they need themselves.
      const toSummary = (row: {
        id: string;
        content: string;
        role: string;
        sources: unknown;
        metadata: unknown;
        createdAt: Date;
      }) => ({
        id: row.id,
        content: row.content,
        role: row.role,
        sources: row.sources as unknown,
        metadata: row.metadata as unknown,
        createdAt: row.createdAt,
      });
      return {
        userMessage: toSummary(message),
        assistantResponse: assistantResponse ? toSummary(assistantResponse) : null,
      };
    }),

  testPipeline: adminProcedure
    .input(
      z.object({
        prompt: z.string().trim().min(5).max(2000),
        // Which pipeline to diagnose: the 3-agent ReAct pipeline or the
        // single-shot standard CRAG pipeline.
        pipeline: z.enum(["agentic", "standard"]).default("agentic"),
        bypassCache: z.boolean().default(true),
        // Developer mode: failures persist the full name/message/cause/stack
        // detail on the run row so admins can debug from the tester UI.
        debug: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input }): Promise<{ runId: string }> => {
      // The glass-box pipeline makes 4–6 sequential LLM calls (15–38s) — far
      // past the synchronous function ceiling on Vercel. Instead of blocking
      // the HTTP request, create a RUNNING row, return its id in ~100ms, and
      // let `after()` run the pipeline in the background. The client polls
      // `getTestRun` until the row reaches a terminal state.
      const run = await prisma.pipelineRun.create({
        data: {
          prompt: input.prompt,
          traceJson: {},
          latencyMs: 0,
          status: "RUNNING",
        },
      });
      let scheduled = false;
      try {
        // Runs after the response is flushed so the request returns in ~100ms.
        // The promise MUST be returned: Next.js hands it to the platform's
        // `waitUntil`, which is what keeps the invocation alive. A floating
        // `void executePipelineTest(...)` returns undefined, so the platform
        // sees no pending work and may freeze the container mid-run — leaving
        // the row stuck in RUNNING forever.
        after(() => executePipelineTest(run.id, input));
        scheduled = true;
      } catch {
        // Not inside a Next.js request scope (unit tests / non-Next runtime):
        // `after()` throws. Run inline so the row still reaches a terminal
        // state and tests exercise the same persistence contract.
        logger.warn({ runId: run.id }, "[ADMIN] after() unavailable — running pipeline inline");
      }
      if (!scheduled) {
        await executePipelineTest(run.id, input);
      }
      logger.info(
        { runId: run.id, prompt: input.prompt },
        "[ADMIN] pipeline test queued (background)",
      );
      return { runId: run.id };
    }),

  listTestRuns: adminProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(50).default(10),
          cursor: z.object({ createdAt: z.coerce.date(), id: z.string().min(1) }).optional(),
        })
        .optional(),
    )
    .query(
      async ({
        input,
      }): Promise<{
        items: PipelineRunListItem[];
        nextCursor: RecentQueriesCursor | null;
      }> => {
        const limit = input?.limit ?? 10;
        const cursor = input?.cursor;
        const where = cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : undefined;
        const rows = await prisma.pipelineRun.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: limit + 1,
          select: {
            id: true,
            prompt: true,
            latencyMs: true,
            status: true,
            error: true,
            createdAt: true,
          },
        });
        const items = rows.slice(0, limit).map((row) => ({
          id: row.id,
          prompt: row.prompt,
          latencyMs: row.latencyMs,
          status:
            row.status === "RUNNING"
              ? ("RUNNING" as const)
              : row.status === "FAILED"
                ? ("FAILED" as const)
                : ("SUCCESS" as const),
          error: row.error,
          createdAt: row.createdAt,
        }));
        const lastItem = rows.length > limit ? rows[limit - 1] : undefined;
        const nextCursor =
          rows.length > limit && lastItem
            ? { createdAt: lastItem.createdAt, id: lastItem.id }
            : null;
        return { items, nextCursor };
      },
    ),

  getTestRun: adminProcedure.input(z.object({ id: z.string().min(1) })).query(async ({ input }) => {
    const run = await prisma.pipelineRun.findUnique({ where: { id: input.id } });
    if (!run) {
      throw new NotFoundError("PipelineRun", input.id);
    }
    // Map traceJson to `unknown` so the tRPC client type doesn't carry the
    // deeply-recursive Prisma JsonValue union (TS2589) — the page casts it to
    // AgenticRagResponse itself.
    return {
      id: run.id,
      prompt: run.prompt,
      latencyMs: run.latencyMs,
      status: run.status,
      error: run.error,
      createdAt: run.createdAt,
      traceJson: run.traceJson as unknown,
    };
  }),
});
