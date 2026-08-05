# Architecture Audit & Fixes
Date: 2026-08-04

## Overview
A comprehensive architectural audit of the codebase was conducted across the database, RAG pipeline, streaming, and ingestion layers.

Status of the audit items below was re-verified on 2026-08-04 against the current working tree after the Milvus dependency was fully removed and the codebase was reverted to a **Postgres-only** vector architecture.

## Applied Fixes (verified in code)

### 1. Fixed In-Memory Corpus & BM25 Rebuild Bottleneck
- **File:** `src/server/rag/retrieval/corpus.ts`
- **Issue:** `PrismaCorpusProvider` loaded the entire document chunk table into Node.js memory unpaginated via `findMany`.
- **Fix:** Implemented a cursor-based pagination loop (`take: 1000`, `skip: 1`) to stream chunks out of the database iteratively, preventing severe memory bloat and garbage collection pauses as the corpus scales.

### 2. Removed Artificial Server-Side Streaming Delays
- **File:** `src/server/rag/chat-pipeline.ts`
- **Issue:** The SSE chat stream endpoint synchronously generated the full answer and then simulated streaming using an artificial `sleep(24ms)` delay loop per 3-word chunk. This unnecessarily kept HTTP connections and Vercel serverless instances alive.
- **Fix:** Removed the `sleep` function (and the now-unused `TOKEN_DELAY_MS` constant). The pipeline now yields tokens to the UI instantly, saving compute time and connection overhead.

### 3. Added Strict Type Guarding to Raw SQL Vector Construction
- **File:** `src/server/db/vector-queries.ts`
- **Issue:** `vectorQueries` formatted vector arrays directly as string literals (`toVectorLiteral`) without checking dimensions or types before passing them into `$queryRaw`.
- **Fix:** Rewrote `toVectorLiteral` to strictly enforce that the input is a valid array of length 768, and that every element is a finite number. This prevents malformed embeddings from causing unhandled PostgreSQL type-casting crashes. (Note: the expected dimension is hard-coded as 768 — it must stay in sync with `EMBEDDING_MODEL` output and `prisma/schema.prisma` `vector(768)`.)

## Reverted / Removed Work (no longer in the codebase)

### 4. Background Execution for Heavy Ingestion (`waitUntil`) — REVERTED
- **Files:** `src/app/api/admin/documents/upload/route.ts`, `src/server/routers/document.ts`
- **Issue:** Document parsing, chunking, and embedding runs synchronously. Large documents risk hitting Vercel's 60-second serverless timeout.
- **Attempted Fix:** Wrapped the execution in Vercel's `@vercel/functions` `waitUntil()` to background the process and return early.
- **Why it was Reverted:**
  1. It broke the UI feedback loop. The frontend expects synchronous confirmation to show success/errors and chunk counts.
  2. It caused the database to be out-of-sync with the UI response (`chunkCount: 0` returned before work completed).
  3. `waitUntil` is still bound by the 60-second function timeout limit (`maxDuration`), so it did not actually solve the timeout risk for large PDFs.
- **Current state:** `document.ts` and the upload route are synchronous again (verified: zero `waitUntil` references in `src/`). The `@vercel/functions` dependency is not used.
- **Future Recommendation:** Implement a proper asynchronous background task queue (e.g., BullMQ, Inngest, or a polling `IngestJobs` database table) combined with frontend polling to handle large document processing without blocking or timing out.

### 5. Milvus Vector Store — REMOVED ENTIRELY (Postgres-only)
- **Files:** `src/server/db/vector/{milvus,store}.ts`, `src/server/rag/retrieval/vector-store.ts` (all deleted), `docker-compose.milvus.yml` (deleted), `@zilliz/milvus2-sdk-node` (removed from dependencies).
- **Issue:** The `MilvusVectorStore` abstraction posed a risk of "orphan vectors" occurring upon document deletion if vectors drifted from the Postgres single-source-of-truth. Using a secondary database also induced latency and split-brain risks.
- **Fix:** Fully excised Milvus from the codebase (code, tests, config, lockfile, build artifacts). No vector-store abstraction remains at all — document deletion relies directly on the Prisma model `ON DELETE CASCADE` in `prisma/schema.prisma`. `VECTOR_STORE` / `MILVUS_*` env vars were removed from `env.ts` and `.env.example`.
- **Current state:** Verified zero Milvus references in `src/`, `tests/`, `package.json`, `pnpm-lock.yaml`, `node_modules`, GitHub workflows, and the Python app; a clean `pnpm build` produces a `.next` artifact with zero Milvus references.
- **Semantic cache:** remains pgvector-only (SHA-256 exact match tier + pgvector cosine tier in `src/server/rag/cache/semantic-cache.ts`), consistent with the single-database architecture.

## Local Docker & SSL Initialization Stability
- **Files:** `docker-compose.yml`, `docker/postgres-init.sql`, `.env.example`
- **Issue:** The developer environment lacked isolated setup, pulling outdated `pgvector` images and relying on production-specific `sslmode=require` flags.
- **Fix:** Authored a local `web-app/docker-compose.yml` leveraging `pgvector/pgvector:pg16` (aligned with CI). Supplied a `docker/postgres-init.sql` bootstrap script mapping the Principle of Least Privilege roles (`behoerden_app` DML-only, `behoerden_migrator` DDL/CREATEDB) into existence on startup and pre-creating the `vector` extension. Updated `.env.example` so `sslmode=require` appears only on cloud (Neon) URLs; local docker Postgres URLs omit it. (An earlier `scripts/init-db.sql` was superseded by `docker/postgres-init.sql` — it over-granted `ALL` privileges to the app role and lacked `CREATEDB` for the migrator, which would have broken the `prisma migrate dev` shadow database.)
