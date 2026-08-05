# Migration Policy — web-app (Prisma + PostgreSQL + pgvector)

Read this before writing or editing **any** migration in `prisma/migrations/`.
This directory holds hand-written SQL, not only Prisma-generated files, so the
rules below are what keep the live database reconcilable with `schema.prisma`.

---

## 1. The intentional HNSW divergence (do not "fix" it)

`schema.prisma` declares vector columns as `Unsupported("vector(768)")`. Prisma
**cannot model an index on an `Unsupported` column** — there is no `@@index`
syntax that produces an HNSW index. As a result, `prisma migrate diff` against
a correctly-provisioned database *always* proposes dropping the HNSW indexes
below. **That proposal is wrong and must never be applied.**

### The three HNSW indexes and their history

| Index | Column | Status | Notes |
|---|---|---|---|
| `document_chunks_embedding_idx` | `document_chunks.embedding` | **KEEP — real search index** | Created in `20260731000000_init` (`USING hnsw ... vector_cosine_ops`). Used by `findSimilarChunks` via the `<=>` cosine operator. |
| `idx_semantic_cache_query_vector_hnsw` | `semantic_cache.queryVector` | **KEEP — real search index** | Created in `20260802000002_add_semantic_cache_hnsw_index` (`WITH (m = 16, ef_construction = 64)`). Used by `findSimilarCacheEntry` via `<=>`. |
| `semantic_cache_queryVector_idx` | `semantic_cache.queryVector` | **DROPPED** | Created in `_init`; duplicate of `idx_semantic_cache_query_vector_hnsw` on the same column. Removed in `20260804000003_reconcile_schema_drift`. |

### Rules

1. **Never drop `document_chunks_embedding_idx` or `idx_semantic_cache_query_vector_hnsw`.** They are the vector search indexes; dropping them silently breaks retrieval (full sequential scans).
2. **Never "clean up" the `migrate diff` output by deleting them.** The residual diff — *only* these two indexes — is a documented, accepted divergence. A correct verification run looks like: *everything else is zero, and the sole remaining diff lines name exactly these two HNSW indexes.*
3. **Never create another HNSW index on the same columns** (that is exactly how the redundant `semantic_cache_queryVector_idx` came to exist).
4. If a genuine reason ever appears to *re-tune* these indexes (new `m`, `ef_construction`, or operator class), do it in a new additive migration and update this table — never by hand-editing an already-applied migration.

---

## 2. How to verify a migration is correct

After applying locally (as `behoerden_migrator`):

```bash
pnpm prisma migrate status          # → "Database schema is up to date!"
# Live DB vs schema.prisma (what CI/fresh DBs will converge on):
pnpm prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --script
```

Interpretation:

- **Expected residual diff:** exactly the two KEEP indexes from §1 (Prisma proposing `DROP INDEX` on them). This is normal.
- **Anything else** (tables, columns, enums, btree indexes, defaults) means the migration set has drifted again — stop and reconcile, don't paper over it.

Also verify PoLP survived type/table recreation: `behoerden_app` must still
`SELECT` and run `<=>` queries. Enum recreations and `CREATE INDEX` are DDL
owned by the migrator; grants must be re-asserted if privileges are lost.

---

## 3. Rules for future hand-written migrations

1. **Naming:** `<YYYYMMDD><HHMMSS>_snake_case/` (14-digit timestamp). The 8-digit
   names caused a P3018 ordering bug in this repo — never reintroduce them.
2. **Order matters:** migrations apply in lexical order. A migration that
   references a table/type must sort *after* the migration that creates it.
3. **Additive by default.** Prefer `CREATE ... IF NOT EXISTS` / `ALTER ... ADD`.
   The one legitimate destructive case is enum-value removal, which requires the
   recreate pattern (§4). Do **not** bake `DROP TABLE IF EXISTS` into migrations
   to "make them rerunnable" — that turns migrations into data-destroyers. For a
   broken dev DB, use `prisma migrate reset`, not hand-rolled drops.
4. **`DROP INDEX IF EXISTS`** is fine and encouraged when removing an index.
5. **Vector columns stay `Unsupported("vector(768)")` in `schema.prisma`.** Do
   not convert them to a supported Prisma type; the type is a load-bearing
   contract with the embedding layer.
6. **Never edit an already-applied migration.** If a migration is wrong on
   environments that already ran it, write a new corrective migration (that is
   what `20260804000003_reconcile_schema_drift` is).
7. **Init SQL and runtime-created objects:** the docker init script
   (`web-app/docker/postgres-init.sql`) pre-creates the `vector` extension and
   PoLP roles; migrations must not assume superuser and must not `CREATE
   EXTENSION` redundantly.

---

## 4. Enum-recreation pattern (the only way to drop a value)

PostgreSQL cannot delete a single enum value. To align an enum with
`schema.prisma`, recreate the type and cast (see
`20260804000003_reconcile_schema_drift/migration.sql` for the full, reviewed
example):

```sql
CREATE TYPE "X_new" AS ENUM (...);                       -- schema's exact values
ALTER TABLE ... ALTER COLUMN ... DROP DEFAULT;
ALTER TABLE ... ALTER COLUMN ... TYPE "X_new"
  USING ("col"::text::"X_new");                          -- fails LOUDLY on bad rows
ALTER TYPE "X" RENAME TO "X_old";
ALTER TYPE "X_new" RENAME TO "X";
DROP TYPE "X_old";
ALTER TABLE ... ALTER COLUMN ... SET DEFAULT ...;        -- re-apply if schema has one
```

**Constraint:** safe only when no live rows use a value being removed — on a
data-bearing table the cast errors rather than corrupting silently. Verify row
counts first; if rows exist, normalize them in the same migration *before* the
type swap. Note the migration still runs in a single transaction (Prisma
wraps it), so a failure rolls back everything.

---

## 5. Check-in checklist

- [ ] 14-digit folder name, sorts after everything it depends on
- [ ] Runs cleanly on a fresh DB: `docker compose down -v && up -d` then `pnpm prisma migrate deploy`
- [ ] `migrate status` → up to date
- [ ] `migrate diff` residual is **only** the two §1 HNSW indexes
- [ ] `behoerden_app` still has DML + vector (`<=>`) access after applying
- [ ] No edits to applied migrations; no `DROP TABLE`; no duplicate HNSW indexes
- [ ] Unit tests + typecheck green (`pnpm test`, `pnpm typecheck`)

---

## 6. Related reading

- `20260804000003_reconcile_schema_drift/migration.sql` — worked example (enums, defaults, duplicate-HNSW removal, btree additions)
- `20260802000002_add_semantic_cache_hnsw_index/migration.sql` — HNSW tuning notes (`m`, `ef_construction`, CONCURRENTLY caveat)
- `docs/status/session-handoff-2026-08-04.md` — session state; drift analysis history
- `web-app/docker/postgres-init.sql` — PoLP roles + extension bootstrap
