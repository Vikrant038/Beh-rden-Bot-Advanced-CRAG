-- Guard the PoLP grants added by 20260805000002_bge_m3_1024_dim.
--
-- That migration unconditionally runs `GRANT ... TO "behoerden_app"`, which is
-- correct on the docker/dev database (roles created by docker/postgres-init.sql)
-- but FAILS on Neon/cloud, where the PoLP roles do not exist and migrations run
-- as the database owner. `prisma migrate deploy` would abort there.
--
-- This corrective migration (per MIGRATION_POLICY §3.6) re-asserts the same
-- grants only when the role actually exists, so both environments converge:
--   * docker dev: role exists → grants applied (idempotent, no-op if already set)
--   * Neon cloud: role absent  → skipped, deploy succeeds
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'behoerden_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      "documents", "document_parent_chunks", "document_chunks", "semantic_cache"
      TO "behoerden_app";
    GRANT USAGE, SELECT ON SEQUENCE
      "document_parent_chunks_id_seq", "document_chunks_id_seq", "semantic_cache_id_seq"
      TO "behoerden_app";
  END IF;
END
$$;
