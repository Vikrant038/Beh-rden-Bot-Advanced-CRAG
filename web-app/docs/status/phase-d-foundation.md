# Phase D — Admin Dashboard, URL Ingest Pipeline, Cache TTL Cron & Langfuse Tracing

**Status:** COMPLETE (pending user verification)
**Date:** 2026-08-01
**Branch:** `web-app`
**Scope:** ROADMAP TASK-037..039

## Summary

The admin dashboard (TASK-037), the URL-ingest pipeline (TASK-038), and the cache-TTL cron with Langfuse tracing (TASK-039) are implemented, wired into the Next.js app, and covered by new tests. All five quality gates pass: 227 tests (36 files) green, coverage above the 80% line/function/statement threshold, lint/format/typecheck/build clean. The Phase-C gated stubs (`document.sync`, `document.ingestUrl`) are now real implementations.

## Tasks Delivered

| Task | Deliverable | Status |
|---|---|---|
| TASK-037 | Admin dashboard + knowledge base: `src/server/routers/admin.ts` gains `users`, `dailyQueries` (14d), `modeSplit`, `recentQueries` (10) via `$queryRaw`; pages `/admin/dashboard`, `/admin/documents`, `/sources`; admin layout (role-guarded client nav) + middleware `/admin` guard; components `metric-card` (animated counter), `dashboard-charts` (Recharts line/pie/bar), `recent-queries-table`, `document-manager`, `source-browser`; sidebar gains Knowledge base / History / Settings / Admin nav | Done |
| TASK-038 | URL ingest pipeline (`src/server/ingest/`): `chunker.ts` (RecursiveCharacterTextSplitter port, 600/150, `minChunkChars=100`), `cleaner.ts` (`clean_text` port from `src/utils.py`), `scraper.ts` (SSRF-safe via `assertSafeUrl`, 20s timeout, entity decode, `extractMainContent`), `pipeline.ts` (`ingestUrl`/`syncAllDocuments`: scrape → clean → SHA-256 hash → chunk → embed → transactional pgvector store → cache + corpus invalidation; idempotent skip on unchanged hash, `force` re-embeds), `cli.ts` (`pnpm ingest`); `document.ingestUrl`/`document.sync` now wired (SSRF guard + real pipeline) | Done |
| TASK-039 | Cache TTL cron + Langfuse tracing: `src/app/api/cron/cleanup-cache/route.ts` (Vercel Cron GET, `Authorization: Bearer CRON_SECRET` guard, deletes expired `semanticCacheEntry`); `vercel.json` schedules `0 4 * * *`; `src/server/tracing.ts` (`runWithTrace`, `runWithTraceGen` via AsyncLocalStorage, `observeGeneration`, `setTraceInput`, no-op when keys missing); integrated into `llm/client.ts` (`callLLM` generation span), `embeddings/client.ts` (`embedTexts` span), `chat-pipeline.ts` (`runChatStreamInner` wrapped by `runWithTraceGen`), `ingest/pipeline.ts`; `env.ts` gains `CRON_SECRET` | Done |

## Quality Gates

| Gate | Command | Result |
|---|---|---|
| Typecheck | `pnpm typecheck` | PASS |
| Lint | `pnpm lint` | PASS (0 errors, 0 warnings) |
| Build | `pnpm build` | PASS |
| Format | `pnpm format:check` | PASS |
| Unit + integration + component tests | `pnpm test` | PASS (227 tests, 36 files) |
| Coverage | `pnpm vitest run --coverage` | PASS (above 80% lines/functions/statements) |

New tests: `tests/unit/{chunker,cleaner,scraper,ingest-pipeline,admin-router,cron-cleanup-route,document-router,tracing}.test.ts` and `src/components/admin/{metric-card,recent-queries-table}.test.tsx`.

## Decisions & Exceptions

- **Ingest idempotency:** content hash (SHA-256 of cleaned text) compared against the stored document; unchanged docs are skipped. `force`/`--force` bypasses the hash check and re-embeds.
- **Transactional chunk store:** `prisma.$transaction` with raw `INSERT ... VALUES ... ::vector` for bulk pgvector rows (matches existing vector storage), followed by `documentChunk.deleteMany` + `document.update(chunkCount)`.
- **SSRF guard:** `document.ingestUrl` and `scraper.scrapeWebPage` both go through `assertSafeUrl` (blocks loopback/RFC1918/link-local/cloud-metadata) before any network I/O.
- **Langfuse fail-open:** tracing no-ops without `LANGFUSE_PUBLIC_KEY/SECRET_KEY`; context flows via AsyncLocalStorage so pipeline signatures stay unchanged.
- **Cron auth:** Vercel Cron hits the route as GET; `CRON_SECRET` bearer check returns 401 otherwise (matches `cron:true` config in `vercel.json`).
- **Admin metrics via raw SQL:** JSONB metadata extraction (`metadata->>'isCached'`, `(metadata->>'latencyMs')::float`) with `.catch` fallback to empty series so a DB hiccup renders an empty chart instead of a 500.
- **Chunker port caveat:** langchain's splitter is re-implemented from scratch (no `langchain` dependency added); behavior verified against the chunker unit tests.
- **Cleaner port verified byte-for-byte** against the Python `clean_text` reference (`src/utils.py:36`), including the boilerplate line filter (repeated lines >3 dropped) and the short-line filter (≤2 chars dropped) — tests encode those exact semantics.
- **`runChatStream` renamed to `runChatStreamInner`** and wrapped by `runWithTraceGen`; the SSE route API is unchanged.
- **Metric-card counter:** rAF-driven count-up animation stubbed in tests to jump straight to the target so jsdom renders deterministic values.
- No local Postgres: DB paths continue to exercise mocked Prisma; `pnpm ingest` CLI requires a reachable `DATABASE_URL` (targets Neon at deploy).

## Notes for Next Phase

- `document.sync`/`ingestUrl` now run the real pipeline; seed the knowledge base via `pnpm ingest --url <url>` on deploy.
- Langfuse tracing is no-op locally; enable `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY` in prod to see traces. `next.config.ts` CSP `connect-src` may need the Langfuse host added for browser-side tracing.
- The admin dashboard renders from `$queryRaw` aggregates; a later phase may add pagination/infinite scroll to `recentQueries`.
- Playwright `test:e2e` still has no specs — needs a seeded DB.

## Verification

Waits on user verification of this push before Phase E begins.
