-- Add HNSW index on semantic_cache.queryVector for fast approximate nearest-neighbour
-- lookups. Without this index the similarity query does a full sequential scan, which
-- becomes the dominant query cost as the cache grows.
--
-- ef_construction=64, m=16 are sensible defaults for a 768-d embedding space.
-- cosine distance matches the <=> operator used in SemanticCache.checkCache.
-- CONCURRENTLY is not supported inside an explicit transaction; Prisma migration
-- runner wraps migrations in a transaction, so we use the standard form here.
-- If you need zero-downtime on a live table, apply this step manually outside the
-- migration transaction: CREATE INDEX CONCURRENTLY ...
CREATE INDEX IF NOT EXISTS idx_semantic_cache_query_vector_hnsw
  ON semantic_cache
  USING hnsw ("queryVector" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
