-- Add single-column indexes on FK columns that Prisma does not create
-- automatically. Without them, sign-in / account-linking lookups by userId
-- (autoLinkOAuthAccount, Auth.js adapter) and ON DELETE CASCADE sweeps from
-- users → accounts/sessions, plus the guest-claim feedback re-parenting, all
-- scan the whole table.
--
-- Additive only: no column or row changes, nothing dropped.
CREATE INDEX IF NOT EXISTS "accounts_userId_idx" ON "accounts"("userId");
CREATE INDEX IF NOT EXISTS "sessions_userId_idx" ON "sessions"("userId");
CREATE INDEX IF NOT EXISTS "message_feedback_userId_idx" ON "message_feedback"("userId");
