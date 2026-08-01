import { router, adminProcedure } from "@/server/trpc/t";
import { prisma } from "@/server/db";
import { semanticCache } from "@/server/rag/cache/semantic-cache";
import { createLogger } from "@/server/lib/logger";

const logger = createLogger("admin-router");

interface MessageStatsRow {
  assistantCount: number;
  cacheHits: number;
  avgLatencyMs: number | null;
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
});
