import { router, adminProcedure, adminLongProcedure } from "@/server/trpc/t";
import { prisma } from "@/server/db";
import { semanticCache } from "@/server/rag/cache/semantic-cache";
import { createLogger } from "@/server/lib/logger";
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

export const adminRouter = router({
  metrics: adminProcedure.query(async (): Promise<AdminMetrics> => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [totalUsers, totalConversations, totalMessages, queriesToday, documentCount, stats] =
      await Promise.all([
        prisma.user.count(),
        prisma.conversation.count(),
        prisma.message.count(),
        prisma.message.count({ where: { role: "USER", createdAt: { gte: startOfToday } } }),
        prisma.document.count(),
        prisma.$queryRaw<MessageStatsRow[]>`
          SELECT
            COUNT(*) FILTER (WHERE role = 'ASSISTANT') AS "assistantCount",
            COUNT(*) FILTER (WHERE role = 'ASSISTANT' AND metadata->>'isCached' = 'true') AS "cacheHits",
            AVG((metadata->>'latencyMs')::float) AS "avgLatencyMs"
          FROM messages
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
        AND "createdAt" >= NOW() - (${input.days} || ' days')::interval
      GROUP BY date
      ORDER BY date ASC
    `
        .then((rows) => rows.map((row) => ({ date: row.date, count: Number(row.count ?? 0) })))
        .catch((error) => {
          logger.warn({ error: String(error) }, "[ADMIN] dailyQueries aggregation failed");
          return [];
        });
    }),

  modeSplit: adminProcedure.query(async (): Promise<ModeSplitPoint[]> => {
    return prisma.$queryRaw<ModeSplitRow[]>`
      SELECT COALESCE(metadata->>'mode', 'standard') AS mode, COUNT(*)::int AS count
      FROM messages
      WHERE role = 'ASSISTANT' AND metadata->>'mode' IS NOT NULL
      GROUP BY mode
      ORDER BY count DESC
    `
      .then((rows) => rows.map((row) => ({ mode: row.mode, count: Number(row.count ?? 0) })))
      .catch((error) => {
        logger.warn({ error: String(error) }, "[ADMIN] modeSplit aggregation failed");
        return [];
      });
  }),

  recentQueries: adminProcedure.query(async (): Promise<RecentQueryRow[]> => {
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
      ORDER BY m."createdAt" DESC
      LIMIT ${RECENT_QUERY_LIMIT}
    `
      .then((rows) =>
        rows.map((row) => ({
          id: row.id,
          conversationId: row.conversationId,
          query: row.query,
          createdAt: row.createdAt,
          mode: row.mode,
          latencyMs: Number(row.latencyMs ?? 0),
          isCached: Boolean(row.isCached),
          retrievalPath: row.retrievalPath ?? null,
        })),
      )
      .catch((error) => {
        logger.warn({ error: String(error) }, "[ADMIN] recentQueries aggregation failed");
        return [];
      });
  }),

  topQuestions: adminProcedure
    .input(z.object({ days: z.number().int().min(1).max(DAILY_QUERY_MAX_DAYS).default(30) }))
    .query(async ({ input }): Promise<Array<{ query: string; count: number }>> => {
      return prisma.$queryRaw<Array<{ query: string; count: number }>>`
        SELECT content AS query, COUNT(*)::int AS count
        FROM messages
        WHERE role = 'USER'
          AND "createdAt" >= NOW() - (${input.days} || ' days')::interval
        GROUP BY content
        ORDER BY count DESC, MAX("createdAt") DESC
        LIMIT 10
      `
        .then((rows) =>
          rows.map((row) => ({ query: row.query, count: Number(row.count ?? 0) })),
        )
        .catch((error) => {
          logger.warn({ error: String(error) }, "[ADMIN] topQuestions aggregation failed");
          return [];
        });
    }),

  failedQueries: adminProcedure.query(
    async (): Promise<
      Array<{ id: string; conversationId: string; query: string; createdAt: Date }>
    > => {
      return prisma.$queryRaw<Array<{ id: string; conversationId: string; query: string; createdAt: Date }>>`
        SELECT m."id", m."conversationId" AS "conversationId", m.content AS query, m."createdAt" AS "createdAt"
        FROM messages m
        WHERE m.role = 'USER'
          AND m."createdAt" >= NOW() - INTERVAL '14 days'
          AND NOT EXISTS (
            SELECT 1 FROM messages a
            WHERE a."conversationId" = m."conversationId"
              AND a.role = 'ASSISTANT'
              AND a."createdAt" > m."createdAt"
          )
        ORDER BY m."createdAt" DESC
        LIMIT 10
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

  testPipeline: adminLongProcedure
    .input(z.object({ prompt: z.string().trim().min(5).max(2000) }))
    .mutation(async ({ input }): Promise<AgenticRagResponse> => {
      const result = await runAgenticRag(input.prompt, {
        hybridRetriever: getHybridRetriever(),
        cache: semanticCache,
        memory: new NoopMemory(),
        bypassCache: true,
      });
      logger.info(
        { prompt: input.prompt, latencyMs: result.totalLatencyMs },
        "[ADMIN] pipeline test complete",
      );
      return result;
    }),
});
