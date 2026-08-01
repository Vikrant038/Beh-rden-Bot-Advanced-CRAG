# Phase B — Core RAG Engine

**Status:** COMPLETE (pending user verification)
**Date:** 2026-07-31
**Branch:** `web-app`
**Scope:** ROADMAP TASK-011..028

## Summary

The core RAG engine is fully ported from the Python reference (`src/{pii_masker,llm_client,retrieval,advanced_retrieval,agentic_rag,semantic_cache,memory}.py`) to TypeScript, wired to Prisma + pgvector, and covered by 104 passing tests (unit + integration) at 90%+ line coverage.

## Tasks Delivered

| Task | Deliverable | Status |
|---|---|---|
| TASK-011 | PII masker (`src/server/pii/masker.ts`, 6 regex patterns, 50k char cap) | Done |
| TASK-012 | Embedding client (`src/server/embeddings/client.ts`, HF feature-extraction, 768-d BGE, query prefix) | Done |
| TASK-013 | LLM client (`src/server/llm/client.ts`: Groq primary + HF fallback, retry/backoff, semaphore, SSE-ready) + circuit breaker (`circuit-breaker.ts`) + `LLMProviderError` | Done |
| TASK-014 | BM25 sparse retrieval (`src/server/rag/retrieval/bm25.ts`, Okapi k1=1.5 b=0.75, epsilon=0) | Done |
| TASK-015 | pgvector dense retrieval (`src/server/rag/retrieval/dense.ts`, cosine, min_sim 0.20, k=15) | Done |
| TASK-016 | RRF fusion (`src/server/rag/retrieval/rrf.ts`, k=60) | Done |
| TASK-017 | HybridRetriever (`src/server/rag/retrieval/hybrid.ts` + `corpus.ts`, dense+sparse+RRF, per-sub-query embedding) | Done |
| TASK-018 | Cross-encoder re-ranker (`src/server/rag/retrieval/reranker.ts`, HF Inference, sigmoid, top-5, graceful fallback) | Done |
| TASK-019 | CRAG gate (`src/server/rag/crag-gate.ts`, ≥0.50 threshold, web fallback) | Done |
| TASK-020 | Domain guardrail Stage-0A (`src/server/rag/guardrail.ts`, LLM classifier fail-open + negative terms) | Done |
| TASK-021 | Query disambiguation Stage-0B (`src/server/rag/disambiguation.ts`, ≤3 words / pronoun-heavy) | Done |
| TASK-022 | Multi-query expansion (`src/server/rag/query-expansion.ts` + `src/server/llm/json.ts` code-fence-stripping `callLLMJson`) | Done |
| TASK-023 | Web search tool (`src/server/rag/tools/web-search.ts`, DuckDuckGo STRICT, DAAD fallback) | Done |
| TASK-024 | Visa calculator (`src/server/rag/tools/visa-calculator.ts`, 992€/mo ×12, 90 ₹/€) | Done |
| TASK-025 | Semantic cache (`src/server/rag/cache/semantic-cache.ts`, SHA-256 exact + pgvector cosine ≥0.97, 7-day TTL) | Done |
| TASK-026 | Summary-buffer memory (`src/server/rag/memory/summary-buffer.ts`, last 8 verbatim + ~300-token rolling summary) | Done |
| TASK-027 | Standard CRAG pipeline (`src/server/rag/pipeline.ts`: mask→embed→cache→expand→hybrid→gate→filter→LLM→persist) | Done |
| TASK-028 | 3-Agent ReAct pipeline (`src/server/rag/agents/{research,analyst,orchestrator}.ts`: Research→Analyst→Writer) | Done |

## Quality Gates

| Gate | Command | Result |
|---|---|---|
| Typecheck | `pnpm typecheck` | PASS |
| Lint | `pnpm lint` | PASS (0 errors, 0 warnings) |
| Build | `pnpm build` | PASS |
| Format | `pnpm format:check` | PASS |
| Unit + integration tests | `pnpm test` | PASS (104 tests, 18 files) |
| Coverage | `pnpm vitest run --coverage` | PASS (lines 90.2%, functions 93.0%, statements 90.3% vs 80% threshold) |

## Decisions & Exceptions

- Circuit breaker state is per-serverless-instance (documented in `circuit-breaker.ts`) — no distributed breaker, matching the "~50 lines, no heavy library" plan.
- BM25 `epsilon` defaults to 0 (vs `rank_bm25`'s 0.25) so non-matching documents score 0 and are filtered.
- Cross-encoder scores are sigmoid-transformed; `fallbackRerank` uses existing `crossScore ?? rrfScore ?? similarityScore` for deterministic ordering on API failure.
- Standard pipeline filters chunks `crossScore ?? similarityScore >= 0.2` after the gate; `pathUsed` marks `CRAG_FALLBACK_UNGROUNDED` vs `LLM_GENERATION_FAILED`.
- Agentic pipeline returns `researchSteps` / `analysisMatrix` / `sources` / `totalLatencyMs`; `isGrounded` is set only in the standard pipeline.
- Semantic cache `addToCache` uses raw `INSERT ... nextval('semantic_cache_id_seq')` because Prisma cannot write the `vector` column; payload is `JSON.parse(JSON.stringify(...))` to satisfy `Prisma.InputJsonValue`.
- The `semantic_cache` column names (`responseJson`, `queryVector`, `parentDocIds`, `expiresAt`) were verified against `prisma/migrations/20260731000000_init/migration.sql` via a probe.
- Vitest config renamed to `vitest.config.mts` (CJS/ESM warning), `include` extended to `tests/integration/**`; `tests/setup.ts` loads `.env`.
- Langfuse tracing intentionally not ported yet (planned for Phase D TASK-039).

## Notes for Next Phase

- Phase C (TASK-029..036) wires tRPC routers (chat, rag, admin) + the Streamlit-style chat UI (`app/page.tsx` landing is still scaffold) + SSE streaming (`callLLMStream` is ready).
- The tRPC `appRouter` is still an empty stub — chat/rag routers attach in Phase C.
- Dense retrieval + semantic-cache vector paths are exercised against mocked Prisma only (no local Postgres); apply migrations against Neon in CI/deploy.
- HF Inference API endpoints used (embeddings, rerank, LLM fallback) — production should pin to a paid inference endpoint or self-hosted TGI for latency.

## Verification

Waits on user verification of this push before Phase C begins (TASK-029..036).

### Recent Fixes (2026-08-01)
- Fixed a raw SQL query bug in `semantic-cache.ts` that used snake_case instead of Prisma's camelCase columns, which threw a 42703 error on cache hit checks.
- Improved error handling in `HfEmbeddingClient` to throw a clear `LLMProviderError` when the HuggingFace API is blocked by the network/ISP (ENOTFOUND).
