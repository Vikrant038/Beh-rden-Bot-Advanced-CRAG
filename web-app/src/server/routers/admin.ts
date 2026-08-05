import { router, adminProcedure, adminLongProcedure } from "@/server/trpc/t";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { semanticCache } from "@/server/rag/cache/semantic-cache";
import { createLogger } from "@/server/lib/logger";
import { NotFoundError } from "@/server/lib/errors";
import { z } from "zod";
import { runAgenticRag, type AgenticRagResponse } from "@/server/rag/agents/orchestrator";
import { getHybridRetriever } from "@/server/rag/instance";

const logger = createLogger("admin-router");

interface MessageStatsRow {
  assistantCount: number;
  cacheHits: number;
  avgLatencyMs: number | null;
}

interface DailyQueryRow {
  date: string;
  count: number;
}

interface ModeSplitRow {
  mode: string;
  count: number;
}

interface RecentQueryRowRaw {
  id: string;
  conversationId: string;
  query: string;
  createdAt: Date;
  mode: string;
  latencyMs: number;
  isCached: boolean;
  retrievalPath: string | null;
}

/**
 * Excludes device-scoped guest rows (guest:<uuid>@local) from user metrics so
 * guest browsing (3.10) does not inflate "Total users".
 */
const EXCLUDE_GUESTS_WHERE = { email: { not: { startsWith: "guest:" } } };

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
  status: "SUCCESS" | "FAILED";
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
          prisma.$queryRaw<MessageStatsRow[]>`
            SELECT
              COUNT(*) FILTER (WHERE role = 'ASSISTANT')::int AS "assistantCount",
              COUNT(*) FILTER (WHERE role = 'ASSISTANT' AND metadata->>'isCached' = 'true')::int AS "cacheHits",
              AVG((metadata->>'latencyMs')::float) AS "avgLatencyMs"
            FROM messages
            ${days ? Prisma.sql`WHERE "createdAt" >= NOW() - make_interval(days => ${days}::integer)` : Prisma.empty}
          `
            .then((rows) => rows[0])
            .catch((error) => {
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
      return prisma.$queryRaw<DailyQueryRow[]>`
      SELECT to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date, COUNT(*)::int AS count
      FROM messages
      WHERE role = 'USER'
        AND "createdAt" >= NOW() - make_interval(days => ${input.days}::integer)
      GROUP BY date
      ORDER BY date ASC
    `
        .then((rows) => rows.map((row) => ({ date: row.date, count: Number(row.count ?? 0) })))
        .catch((error) => {
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
      return prisma.$queryRaw<ModeSplitRow[]>`
        SELECT COALESCE(metadata->>'mode', 'standard') AS mode, COUNT(*)::int AS count
        FROM messages
        WHERE role = 'ASSISTANT' AND metadata->>'mode' IS NOT NULL
          ${days ? Prisma.sql`AND "createdAt" >= NOW() - make_interval(days => ${days}::integer)` : Prisma.empty}
        GROUP BY mode
        ORDER BY count DESC
      `
        .then((rows) => rows.map((row) => ({ mode: row.mode, count: Number(row.count ?? 0) })))
        .catch((error) => {
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
        const take = limit + 1;
        return prisma.$queryRaw<RecentQueryRowRaw[]>`
        SELECT m."id",
               m."conversationId" AS "conversationId",
               m.content AS query,
               m."createdAt" AS "createdAt",
               COALESCE(a.metadata->>'mode', 'standard') AS mode,
               COALESCE((a.metadata->>'latencyMs')::float, 0) AS "latencyMs",
               COALESCE(a.metadata->>'isCached', 'false') = 'true' AS "isCached",
               a.metadata->>'retrievalPath' AS "retrievalPath"
        FROM messages m
        CROSS JOIN LATERAL (
          SELECT "metadata"
          FROM messages a
          WHERE a."conversationId" = m."conversationId"
            AND a.role = 'ASSISTANT'
            AND a."createdAt" > m."createdAt"
          ORDER BY a."createdAt" ASC
          LIMIT 1
        ) a
        WHERE m.role = 'USER'
           ${days ? Prisma.sql`AND m."createdAt" >= NOW() - make_interval(days => ${days}::integer)` : Prisma.empty}
          ${
            cursor
              ? Prisma.sql`AND (
                  m."createdAt" < ${cursor.createdAt}
                  OR (m."createdAt" = ${cursor.createdAt} AND m."id" < ${cursor.id})
                )`
              : Prisma.empty
          }
        ORDER BY m."createdAt" DESC, m."id" DESC
        LIMIT ${take}
      `
          .then((rows) => {
            const items = rows.slice(0, limit).map((row) => ({
              id: row.id,
              conversationId: row.conversationId,
              query: row.query,
              createdAt: row.createdAt,
              mode: row.mode,
              latencyMs: Number(row.latencyMs ?? 0),
              isCached: Boolean(row.isCached),
              retrievalPath: row.retrievalPath ?? null,
            }));
            const lastItem = rows.length > limit ? rows[limit - 1] : undefined;
            const nextCursor =
              rows.length > limit && lastItem
                ? { createdAt: lastItem.createdAt, id: lastItem.id }
                : null;
            return { items, nextCursor };
          })
          .catch((error) => {
            logger.warn({ error: String(error) }, "[ADMIN] recentQueries aggregation failed");
            return { items: [], nextCursor: null };
          });
      },
    ),

  topQuestions: adminProcedure
    .input(z.object({ days: z.number().int().min(1).max(DAILY_QUERY_MAX_DAYS).default(30) }))
    .query(async ({ input }): Promise<Array<{ query: string; count: number }>> => {
      return prisma.$queryRaw<Array<{ query: string; count: number }>>`
        SELECT content AS query, COUNT(*)::int AS count
        FROM messages
        WHERE role = 'USER'
           AND "createdAt" >= NOW() - make_interval(days => ${input.days}::integer)
        GROUP BY content
        ORDER BY count DESC, MAX("createdAt") DESC
        LIMIT 10
      `
        .then((rows) => rows.map((row) => ({ query: row.query, count: Number(row.count ?? 0) })))
        .catch((error) => {
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
        return prisma.$queryRaw<
          Array<{ id: string; conversationId: string; query: string; createdAt: Date }>
        >`
          SELECT m."id", m."conversationId" AS "conversationId", m.content AS query, m."createdAt" AS "createdAt"
          FROM messages m
          WHERE m.role = 'USER'
             AND m."createdAt" >= NOW() - make_interval(days => ${days}::integer)
            AND NOT EXISTS (
              SELECT 1 FROM messages a
              WHERE a."conversationId" = m."conversationId"
                AND a.role = 'ASSISTANT'
                AND a."createdAt" > m."createdAt"
            )
          ORDER BY m."createdAt" DESC
          LIMIT ${limit}
        `
          .then((rows) =>
            rows.map((row) => ({
              id: row.id,
              conversationId: row.conversationId,
              query: row.query,
              createdAt: row.createdAt,
            })),
          )
          .catch((error) => {
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

  testPipeline: adminLongProcedure
    .input(
      z.object({
        prompt: z.string().trim().min(5).max(2000),
        bypassCache: z.boolean().default(true),
        // Developer mode: rethrows failures with the full name/message/cause/stack
        // so admins can debug the pipeline from the tester UI. Off by default.
        debug: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input }): Promise<AgenticRagResponse> => {
      const startedAt = Date.now();
      try {
        const result = await runAgenticRag(input.prompt, {
          hybridRetriever: getHybridRetriever(),
          cache: semanticCache,
          memory: new NoopMemory(),
          bypassCache: input.bypassCache,
        });
        await prisma.pipelineRun
          .create({
            data: {
              prompt: input.prompt,
              traceJson: result as unknown as Prisma.InputJsonValue,
              latencyMs: result.totalLatencyMs,
              status: "SUCCESS",
            },
          })
          .catch((persistError) => {
            logger.warn(
              { error: String(persistError) },
              "[ADMIN] failed to persist successful pipeline run",
            );
          });
        logger.info(
          { prompt: input.prompt, latencyMs: result.totalLatencyMs },
          "[ADMIN] pipeline test complete",
        );
        return result;
      } catch (error) {
        const latencyMs = Date.now() - startedAt;
        const detail = input.debug
          ? formatDebugError(error)
          : error instanceof Error
            ? error.message
            : String(error);
        await prisma.pipelineRun
          .create({
            data: {
              prompt: input.prompt,
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
          { prompt: input.prompt, latencyMs, debug: input.debug },
          "[ADMIN] pipeline test failed",
        );
        // Developer mode surfaces the full failure (stack + cause) through the
        // tRPC error message; otherwise keep the plain message as before.
        if (input.debug) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: detail });
        }
        throw error;
      }
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
          status: row.status === "FAILED" ? ("FAILED" as const) : ("SUCCESS" as const),
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
