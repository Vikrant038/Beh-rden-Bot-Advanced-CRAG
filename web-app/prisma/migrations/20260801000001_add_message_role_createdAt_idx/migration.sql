-- CreateIndex
-- Admin dashboard queries (dailyQueries, modeSplit, recentQueries, metrics)
-- filter on Message.role and Message.createdAt. The existing compound index
-- [conversationId, createdAt] cannot serve these filters, so without this
-- index the dashboard performs sequential scans of the messages table as it
-- grows. Index creation is online in Postgres 11+ (CREATE INDEX CONCURRENTLY
-- semantics via plain CREATE INDEX with default lock behaviour is fine for
-- Neon's branch-based zero-downtime deploy model).
CREATE INDEX "messages_role_createdAt_idx" ON "messages"("role", "createdAt");
