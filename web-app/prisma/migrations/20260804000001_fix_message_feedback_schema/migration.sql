-- ─────────────────────────────────────────────────────────────────────────────
-- Fix message_feedback table: align database schema with Prisma schema.
--
-- The catch-up migration (20260802) created message_feedback with:
--   - rating as SMALLINT (should be FeedbackRating enum)
--   - comment column (not in Prisma schema)
--   - missing updatedAt column (in Prisma schema)
--
-- This migration corrects all three issues.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Create the FeedbackRating enum if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FeedbackRating') THEN
    CREATE TYPE "FeedbackRating" AS ENUM ('UP', 'DOWN');
  END IF;
END$$;

-- 2. Migrate rating from SMALLINT to FeedbackRating enum
--    Map: 1 = UP, -1 = DOWN (common convention), 0 or NULL = skip
ALTER TABLE "message_feedback"
  ALTER COLUMN "rating" DROP DEFAULT,
  ALTER COLUMN "rating" TYPE "FeedbackRating"
  USING CASE
    WHEN "rating"::smallint > 0 THEN 'UP'::"FeedbackRating"
    ELSE 'DOWN'::"FeedbackRating"
  END,
  ALTER COLUMN "rating" SET DEFAULT 'UP'::"FeedbackRating";

-- 3. Add updatedAt column (present in Prisma schema, missing from DB)
ALTER TABLE "message_feedback"
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 4. Drop comment column (in DB but not in Prisma schema)
ALTER TABLE "message_feedback"
  DROP COLUMN IF EXISTS "comment";