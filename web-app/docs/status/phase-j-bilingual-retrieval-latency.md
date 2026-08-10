# Phase J — Bilingual Retrieval & Latency Optimization (bge-m3)

> **Status:** Implemented and verified (2026-08-05). Full suite **410 tests / 51 files**, coverage gate
> green (**Lines 85.32% · Functions 82.34% · Statements 85.26%**, thresholds ≥80). `format:check`,
> `typecheck`, `lint` clean.
> **Touches:** `query-expansion.ts`, `pipeline.ts`, `agents/research.ts`, `retrieval/hybrid.ts` + tests.

## 1. Why (measured corpus)

The knowledge base is **bilingual, ~2/3 English**:

| Language | Chunks | Share |
|---|---|---|
| English | 16,201 | 67.7% |
| German | 7,733 | 32.3% |

BM25 is **lexical** (exact token match): an English-only sub-query can never match German chunks
and vice-versa, so retrieval previously had no sparse coverage on one half of the corpus and
frequently tripped the CRAG web fallback. Dense (pgvector, `BAAI/bge-m3`, multilingual 1024-d)
already spans both languages in one space — it was the **sparse path that needed both languages**.

## 2. Decisions (ADR-style)

| Decision | Option | Verdict |
|---|---|---|
| Query expansion language | English-only (previous) | ❌ Leaves German BM25 dead; misses 32.3% of the corpus |
| | **Translate-to-German only** | ❌ Silences lexical matching on the 67.7% English majority |
| | **Bilingual expansion (EN + DE)** | ✅ **Chosen** — dual-BM25 coverage on both halves, dense unchanged |
| Expansion determinism | Prompt "at least one of each" | ❌ Split left to LLM compliance (could return 3 EN + 1 DE) |
| | **Structured JSON `{english:[], german:[]}` → exactly 2+2** | ✅ **Chosen** — deterministic split, still ONE LLM call |
| Embedding round-trips | One `embedQuery()` per sub-query (sequential) | ❌ 5 sub-queries → 5 Vercel→Cloudflare worker round-trips + inference each |
| | **One batched `embedTexts()` for all sub-queries** | ✅ **Chosen** — worker contract accepts `{"inputs": [...]}` → `number[][]` in order |
| Dense pgvector lookups | Sequential per sub-query | ❌ 5 × DB latency serially |
| | **`Promise.all` over sub-queries** | ✅ **Chosen** — read-only, pool-safe, RRF is order-agnostic |

### Cloudflare worker scope (confirmed)

The Cloudflare Worker (`embeddings-worker/`) is used for **query-time embedding only**. Corpus
embedding runs through the local `mvp-python/scripts/embed-server.py` (sentence-transformers) at ingest;
reranking uses a separate HF endpoint; generation uses Groq. The batch change therefore collapses
the worker traffic from **~6 sequential calls per turn to 1**.

### Correctness invariants (why nothing breaks)

1. **Prefix parity** — `HfEmbeddingClient.embedQuery` prepends
   `QUERY_EMBEDDING_PREFIX` (`"Represent this sentence for searching relevant passages: "`) to
   every query. The batched path applies the **same prefix per sub-query**, keeping vectors in the
   corpus space (asymmetric bge model; get it backwards and retrieval silently degrades).
2. **Index pairing** — the worker/HF contract returns vectors in input order; `queryVectors[i]` is
   zipped back to `queries[i]`.
3. **RRF invariance** — RRF fuses on scores/ranks, not order, so the fused result is identical to
   the sequential version.
4. **Caller API unchanged** — `HybridRetriever.retrieve(query, queries)` keeps its signature;
   `pipeline.ts` and `research.ts` only changed the sub-query *list*, not the call.

## 3. What changed

| File | Change |
|---|---|
| `src/server/rag/query-expansion.ts` | `generateSubQueries` asks for a structured `{"english": [...], "german": [...]}` response; returns original + exactly 2 EN + 2 DE alternatives (default `numQueries=5`); dedupe + 500-char cap + `[query]` fallback on parse failure. |
| `src/server/rag/pipeline.ts` | Standard CRAG now requests `generateSubQueries(maskedQuestion, 5)` (was 3 English-only). |
| `src/server/rag/agents/research.ts` | Research agent's primary retrieval uses the bilingual expansion (was `retrieve(userQuery, [userQuery])`). |
| `src/server/rag/retrieval/hybrid.ts` | `retrieve()` embeds **all** sub-queries in **one** `embedTexts()` call (prefix applied per query) and runs the dense pgvector lookups in parallel via `Promise.all`. |

## 4. Latency impact

| Step (per turn) | Before | After |
|---|---|---|
| Sub-query embedding calls to CF worker | 5–6 sequential | **1 batched** |
| Dense pgvector queries | 5 sequential | **5 parallel** |
| BM25 | unchanged (in-memory, sync) | unchanged |
| LLM calls (disambiguation → guardrail → expansion → 3 agents) | dominant | **unchanged — still the main cost** |

Embedding+DB time drops from ~N×(RTT+inference) to ~1 RTT + 1 inference batch. Note the largest
remaining latency is the **sequential LLM call chain**; the "generate-then-stream" design also means
the first token waits for the whole pipeline. Keep-alive is already the undici default within a turn;
Cloudflare AI Gateway caching would only help duplicate queries (the app's semantic cache ≥0.97
already short-circuits whole answers) and is optional infra, not code.

## 5. Verification

- `tests/unit/query-expansion.test.ts` — 7 tests (2+2 deterministic split, odd `numQueries`, dedupe,
  empty filter, char budget, parse-failure fallback, empty-object fallback).
- `tests/integration/retrieval.test.ts` — new test asserts `embedTexts` is called **once** with
  prefixed queries, `embedQuery` is **not** called during `retrieve`, and dense runs 2× for 2 queries.
- Full suite: **410/410 pass**; coverage gate EXIT 0; `format:check` / `typecheck` / `lint` clean.

## 6. Trade-offs & notes

- Cost: one extra (reused) LLM call for bilingual expansion was already in place; batching adds **no**
  extra cost and reduces worker requests.
- Cross-lingual semantic-cache hits stay rare (≥0.97 threshold is tight across languages) — harmless.
- If latency still matters after this, the next lever is the **LLM call chain** (parallel
  Analyst/Writer, skip disambiguation for specific queries, or true token streaming), not embeddings.

## 7. Addendum — BM25 O(vocab) scoring fix (2026-08-06)

> **Status:** Implemented and verified. Full suite **414/414 pass**, `typecheck`, `format:check`,
> `lint` clean. Bench marked at production scale against the live corpus.
> **Touches:** `src/server/rag/retrieval/bm25.ts` + dead-code cleanup in `chat-input.tsx`,
> `chat-interface.tsx`, `document-manager.tsx`, `hybrid.ts`; bounded HF timeouts in
> `embeddings/client.ts`, `llm/client.ts`, `reranker.ts`; `after()` promise return in
> `routers/admin.ts`. Bench scripts: `scratch/corpus-stats.mts`, `scratch/bm25-bench.mts`.

### 7.1 The bug (measured)

A real production trace showed **Sparse Search (BM25) at 147,757 ms** for the 5 bilingual
sub-queries — 38% of a 388 s run. Root cause: `BM25Okapi.getScore()` called
`getAverageIdf()` on **every document**, and that helper re-walked the **entire vocabulary**
(26,158 distinct terms) each call. With 23,934 chunks × 5 sub-queries:

```
23,934 docs × 26,158 terms × 5 sub-queries ≈ 3.1B iterations
```

The average-IDF value is only used for the `epsilon` baseline (default `0`), so it was pure
waste on every score computation. Everything else in the retrieve path — dense pgvector,
RRF, cross-encoder — was already fast; this single O(docs × vocab) hotspot dominated.

### 7.2 The fix

`getAverageIdf()` is now **memoized** — computed lazily on first use and cached in
`averageIdfCache`, instead of re-walking the vocabulary on every scored document. Per-document
scoring drops from O(vocabulary) to O(query_length). The BM25 index itself is unchanged — the
WeakMap-per-corpus caching and the 60 s corpus TTL already ensured the index is built once per
corpus lifetime.

### 7.3 Measured result (production corpus, real Postgres)

`scratch/bm25-bench.mts` loads all 23,934 chunks, builds the index, and runs the exact 5
sub-queries from the APS trace:

| Step | Before | After |
|---|---|---|
| Index build (23,934 docs) | — | **73 ms** |
| 5 sub-query sparse search | **147,757 ms** | **32 ms** |

~**4,600×** faster. Sparse is no longer the pipeline bottleneck; the dominant remaining cost is
the sequential LLM call chain (see §6).

### 7.4 Related hardening shipped with this batch

- **Bounded HF timeouts** — `embeddings/client.ts`, `llm/client.ts`, `reranker.ts` now race each
  `fetch` against `AbortSignal.timeout(...)` (20 s / 20 s / 15 s; LLM combines the caller's
  signal via `AbortSignal.any`). `wait_for_model` holds the socket open through cold starts,
  so without a deadline a stalled provider blocked the whole pipeline.
- **`after()` promise returned** — `routers/admin.ts` now returns the `executePipelineTest`
  promise from `after()`, so Next.js hands it to the platform `waitUntil` and keeps the
  invocation alive (a floating `void` left rows stuck in `RUNNING`).
- **SSE chat route `maxDuration` 60 → 300** — matches the tRPC route (Vercel Hobby ceiling).
  With BM25 fixed, retrieval is ~100 ms, but a cold embeddings-worker start (each embed call
  bounded at 20 s) can still push a run past 60 s; at 60 s the platform killed the stream
  mid-flight, which is the "nothing prints in chat" symptom on Vercel.
- **Dead-code cleanup** — removed unused `progress` prop chain (`chat-input.tsx` /
  `chat-interface.tsx`) and unused `LayoutGrid`/`List`/`HybridRetrievalResult` imports that the
  production build flagged.

> **Next hotspot (if latency still matters):** embedding round-trips to the Cloudflare worker
> during cold starts — `hybrid_retrieval` spent ~200 s embedding in the original trace. The new
> 20 s timeout bounds each call and the agentic tool wrapper degrades to web search on failure,
> but a warm-worker/cached-model strategy (or lowering `wait_for_model` reliance) would cut that
> further. See §6.

## 8. Addendum — corpus transfer eliminated via Postgres FTS (2026-08-06)

> **Status:** Implemented and verified. Full suite **422/422 pass**, `typecheck`, `format:check`,
> `lint` clean. Migration `20260806000001` applied locally (additive GIN index, no data change).
> **Touches:** `src/server/db/vector-queries.ts` (`sparseSearch` + EN/DE stopword list),
> `src/server/rag/retrieval/hybrid.ts` (FTS-first sparse with BM25 fallback, corpus-load timer),
> `src/server/rag/retrieval/corpus.ts` (TTL 60 s → 1 h, batch 1000 → 5000),
> `src/components/sidebar/conversation-item.tsx` (hover/focus prefetch),
> telemetry types (`server/rag/types.ts`, `lib/chat/types.ts`).

### 8.1 Why (measured trace gap)

After §7 the sparse search itself was ~32 ms, but a 13.7 s production trace still hid **~8.9 s of
unaccounted time** inside `hybrid_retrieval`: the first line of `retrieve()`,
`corpusProvider.loadChunks()`, transferred the **entire 23,934-chunk / 3.5 MB corpus** from
Postgres in **25 sequential round-trips** (batch 1000), then rebuilt the in-process BM25 index
over it. Local it measured 161 ms; on Vercel with a remote DB it dominates the turn. Worse, the
corpus TTL was 60 s and the BM25 index is a WeakMap keyed on the corpus array identity, so every
cache expiry rebuilt the index too.

### 8.2 The fix — sparse search moves into Postgres

- **`vectorQueries.sparseSearch`** — ranked lexical retrieval with `to_tsvector('simple', text) @@
  tsquery` + `ts_rank`, backed by a new **GIN index** (`20260806000001_add_document_chunks_fts_index`).
  The `'simple'` config does no stemming — same lexical behavior as the in-process BM25 tokenizer
  on the bilingual corpus. Returns only top-K, so the **server never loads the corpus at all** on
  the FTS path.
- **EN+DE stopword filter** — a naive OR-joined tsquery is dominated by function words (`is | the |
  for` matches nearly every English sentence), which ranks long generic docs above targeted ones —
  the opposite of BM25's IDF. The built-in filter drops ~180 common EN/DE function words so FTS
  ranking approximates BM25's term-overlap behavior (see §8.4 for the measured parity).
- **BM25 stays as a runtime fallback** — if `sparseSearch` throws (e.g. a fresh DB missing the
  index), `retrieve()` falls back to the in-process BM25 over the cached corpus, so a missing
  migration degrades gracefully instead of breaking retrieval.
- **Corpus provider hardened** — TTL raised 60 s → **1 h** (the corpus only changes on ingest, and
  ingest calls `invalidate()` explicitly) and batch size 1000 → 5000 (5 round-trips instead of
  25) for the fallback path.
- **Telemetry** — `RetrievalTelemetry` gains `corpusLoadDurationMs` (0 on the FTS path) and
  `sparseEngine` (`pg_fts` | `bm25_inproc`), so the trace shows exactly where time goes.
- **Sidebar prefetch** — `ConversationItem` now calls `conversation.getById.prefetch` on
  hover/focus, so switching chats is a cache hit instead of a cold round-trip (staleTime is 5 min).

### 8.3 Measured result (production corpus, real Postgres)

`scratch/fts-recall2.mts` runs the exact 5 bilingual sub-queries against both engines:

| Step | Before | After |
|---|---|---|
| Sparse search, 5 sub-queries (FTS) | — | **66 ms** |
| Corpus transfer (3.5 MB / 23,934 chunks) | ~25 round-trips | **0 (not loaded)** |
| BM25 fallback (unchanged path) | 32 ms | 27 ms |

### 8.4 Retrieval parity (BM25 vs FTS, top-200)

| Query | BM25 top-15 in FTS top-200 | Top-200 overlap |
|---|---|---|
| APS certificate (EN) | 15/15 | 107/200 |
| APS-Zertifizierung (DE) | 10/15 | 77/200 |
| Blocked account 2026 (EN) | 15/15 | 135/200 |
| Sperrkonto (DE) | 13/15 | 90/200 |
| Goethe B2 (DE) | 15/15 | 45/200 |

Strong recall parity: all or most of BM25's top-15 appear within FTS's top-200 for every query,
with the fused ranking re-ordered by the cross-encoder and CRAG gate afterwards — so downstream
behavior (rerank → gate → web fallback) is preserved while the 3.5 MB transfer disappears.

### 8.5 Deployment note

Apply `20260806000001` to Neon (`prisma migrate deploy`) alongside the existing corpus seed; it is
**additive** (CREATE INDEX IF NOT EXISTS) and needs no re-embedding or data migration. If it is
missing, retrieval still works via the BM25 fallback.
