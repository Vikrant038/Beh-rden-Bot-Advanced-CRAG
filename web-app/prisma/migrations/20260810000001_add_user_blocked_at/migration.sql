-- Add user-management suspension flag (admin surface).
--
-- Non-null blockedAt = the account is blocked: tRPC auth, the chat stream
-- route and sign-in all reject the user. Additive only; nothing is dropped
-- and no enum is recreated (per MIGRATION_POLICY §3.3).
ALTER TABLE "users" ADD COLUMN "blockedAt" TIMESTAMP(3);
