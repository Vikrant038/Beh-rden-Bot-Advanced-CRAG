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
embedding runs through the local `scripts/embed-server.py` (sentence-transformers) at ingest;
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
