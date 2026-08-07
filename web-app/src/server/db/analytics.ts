/**
 * Analytics queries (admin metrics + public corpus stats).
 *
 * Centralizes every `$queryRaw` aggregation that previously lived inline in
 * `routers/admin.ts` and `routers/public.ts`. Moving them here gives three wins:
 *
 * 1. **Shared time-window fragment** — the `make_interval(days => …)` predicate
 *    was copy-pasted in 6 admin queries; `timeWindow()` is now the one builder.
 * 2. **Testability** — each function is a pure `(prisma, opts) => domain` unit
 *    with no tRPC coupling.
 * 3. **Single source of truth for analytics SQL** — routers become thin
 *    tRPC adapters over these functions; the SQL is auditable in one file.
 *
 * Output shapes match the previous inline query results exactly (the tRPC
 * client contract is unchanged).
 */

import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

/** `AND created_at >= now() - interval 'N days'` fragment, or empty when no window. */
export function timeWindow(days?: number): Prisma.Sql {
  return days
    ? Prisma.sql`AND "createdAt" >= NOW() - make_interval(days => ${days}::integer)`
    : Prisma.empty;
}

// ─── Admin message stats ────────────────────────────────────────────────────

export interface MessageStatsRow {
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

/** Excludes device-scoped guest rows (guest:<uuid>@local) from user metrics. */
export const EXCLUDE_GUESTS_WHERE = { email: { not: { startsWith: "guest:" } } };

export async function messageStats(
  prisma: PrismaClient,
  days?: number,
): Promise<MessageStatsRow | undefined> {
  const rows = await prisma.$queryRaw<MessageStatsRow[]>`
    SELECT
      COUNT(*) FILTER (WHERE role = 'ASSISTANT')::int AS "assistantCount",
      COUNT(*) FILTER (WHERE role = 'ASSISTANT' AND metadata->>'isCached' = 'true')::int AS "cacheHits",
      AVG((metadata->>'latencyMs')::float) AS "avgLatencyMs"
    FROM messages
    ${timeWindow(days)}
  `;
  return rows[0];
}

// ─── Admin daily queries ────────────────────────────────────────────────────

export interface DailyQueryRow {
  date: string;
  count: number;
}

export async function dailyQueries(
  prisma: PrismaClient,
  days: number,
): Promise<DailyQueryRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{ date: string; count: number | bigint | null }>
  >`
    SELECT to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date, COUNT(*)::int AS count
    FROM messages
    WHERE role = 'USER'
      AND "createdAt" >= NOW() - make_interval(days => ${days}::integer)
    GROUP BY date
    ORDER BY date ASC
  `;
  return rows.map((row) => ({ date: row.date, count: Number(row.count ?? 0) }));
}

// ─── Admin mode split ───────────────────────────────────────────────────────

export interface ModeSplitRow {
  mode: string;
  count: number;
}

export async function modeSplit(
  prisma: PrismaClient,
  days?: number,
): Promise<ModeSplitRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{ mode: string; count: number | bigint | null }>
  >`
    SELECT COALESCE(metadata->>'mode', 'standard') AS mode, COUNT(*)::int AS count
    FROM messages
    WHERE role = 'ASSISTANT' AND metadata->>'mode' IS NOT NULL
      ${timeWindow(days)}
    GROUP BY mode
    ORDER BY count DESC
  `;
  return rows.map((row) => ({ mode: row.mode, count: Number(row.count ?? 0) }));
}

// ─── Admin recent queries ───────────────────────────────────────────────────

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

export interface RecentQueriesCursor {
  createdAt: Date;
  id: string;
}

export interface RecentQueriesPage {
  items: RecentQueryRow[];
  nextCursor: RecentQueriesCursor | null;
}

export async function recentQueries(
  prisma: PrismaClient,
  options: { limit: number; days?: number; cursor?: RecentQueriesCursor },
): Promise<RecentQueriesPage> {
  const { limit, days, cursor } = options;
  const take = limit + 1;
  const rows = await prisma.$queryRaw<
    Array<
      RecentQueryRow & {
        // rows are shaped by the SQL; numbers may arrive as bigint
        count?: number | bigint | null;
      }
    >
  >`
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
       ${timeWindow(days)}
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
  `;

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
    rows.length > limit && lastItem ? { createdAt: lastItem.createdAt, id: lastItem.id } : null;
  return { items, nextCursor };
}

// ─── Admin top questions ────────────────────────────────────────────────────

export async function topQuestions(
  prisma: PrismaClient,
  days: number,
): Promise<Array<{ query: string; count: number }>> {
  const rows = await prisma.$queryRaw<
    Array<{ query: string; count: number | bigint | null }>
  >`
    SELECT content AS query, COUNT(*)::int AS count
    FROM messages
    WHERE role = 'USER'
       AND "createdAt" >= NOW() - make_interval(days => ${days}::integer)
    GROUP BY content
    ORDER BY count DESC, MAX("createdAt") DESC
    LIMIT 10
  `;
  return rows.map((row) => ({ query: row.query, count: Number(row.count ?? 0) }));
}

// ─── Admin failed queries ───────────────────────────────────────────────────

export async function failedQueries(
  prisma: PrismaClient,
  options: { days: number; limit: number },
): Promise<Array<{ id: string; conversationId: string; query: string; createdAt: Date }>> {
  const { days, limit } = options;
  const rows = await prisma.$queryRaw<
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
  `;
  return rows.map((row) => ({
    id: row.id,
    conversationId: row.conversationId,
    query: row.query,
    createdAt: row.createdAt,
  }));
}

// ─── Public corpus stats ────────────────────────────────────────────────────

export interface GermanChunkStats {
  german: number;
  total: number;
}

export async function germanChunkStats(
  prisma: PrismaClient,
): Promise<GermanChunkStats> {
  const rows = await prisma.$queryRaw<Array<{ german: bigint; total: bigint }>>`
    SELECT
      count(*) FILTER (WHERE text ~ '[äöüßÄÖÜ]') AS german,
      count(*) AS total
    FROM document_chunks;
  `;
  const first = rows[0];
  return { german: Number(first?.german ?? 0), total: Number(first?.total ?? 0) };
}