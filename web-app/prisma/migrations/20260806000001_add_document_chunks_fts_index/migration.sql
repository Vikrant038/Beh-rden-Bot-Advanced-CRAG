-- Sparse (BM25-equivalent) retrieval moves into Postgres: a GIN index over
-- to_tsvector('simple', text) lets vectorQueries.sparseSearch rank chunks with
-- ts_rank inside the database and return only top-K, eliminating the full
-- 3.5MB corpus transfer per request on serverless (the largest remaining
-- latency hotspot after the BM25 memoization fix).
--
-- 'simple' config = no stemming, tokenizes on whitespace/punctuation — the same
-- lexical behavior as the in-process BM25 tokenizer for the bilingual corpus.
-- Additive only: no column or row changes; in-process BM25 remains as a
-- runtime fallback if this index is ever missing.
CREATE INDEX IF NOT EXISTS document_chunks_text_fts_idx
  ON document_chunks
  USING GIN (to_tsvector('simple', text));
