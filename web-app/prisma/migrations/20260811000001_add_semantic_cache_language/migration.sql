-- Record the language a cached answer was written in (ISO 639-1). The answer
-- language is detected at generation time (query expansion); storing it lets a
-- cache hit tell the client whether the cached answer matches the current
-- user's query language, so it can be flagged or re-rendered when it doesn't.
-- Nullable: existing rows (written before this migration) have no language.
ALTER TABLE semantic_cache ADD COLUMN IF NOT EXISTS "language" TEXT;
