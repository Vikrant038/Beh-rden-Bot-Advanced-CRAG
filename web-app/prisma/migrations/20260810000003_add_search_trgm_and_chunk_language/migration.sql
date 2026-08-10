-- 1) Trigram search index. source.searchChunks runs `text ILIKE '%…%'`, which
-- a B-tree index cannot serve (leading wildcard), so every search was a full
-- table scan over all chunks. A GIN trigram index makes the LIKE pattern
-- index-backed instead. pg_trgm is a trusted extension (safe to CREATE on
-- Neon and standard Postgres).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS document_chunks_text_trgm_idx
  ON document_chunks USING GIN (text gin_trgm_ops);

-- 2) Chunk language flag. germanChunkStats (the public landing page) used to
-- regex-scan every chunk (`text ~ '[äöüßÄÖÜ]'`) on every unauthenticated page
-- load. Store the flag at ingest time and backfill existing rows once, then
-- the aggregate reads a small partial index instead of scanning all rows.
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS "isGerman" BOOLEAN NOT NULL DEFAULT false;
UPDATE document_chunks SET "isGerman" = (text ~ '[äöüßÄÖÜ]');
CREATE INDEX IF NOT EXISTS document_chunks_isGerman_idx
  ON document_chunks ("isGerman") WHERE "isGerman" = true;
