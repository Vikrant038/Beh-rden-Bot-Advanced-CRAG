# Database Architecture Evaluation & Improvement Plan — web-app

> **Author:** Senior Full-Stack Architect review
> **Date:** 2026-08-07
> **Scope:** `Repo-2/web-app` only — Next.js 15.5 (App Router, Turbopack), TypeScript, Prisma + pgvector, tRPC v11, NextAuth v5, pnpm.
> **Method:** Every file under `src/server/` and `src/lib/` that imports the Prisma client or issues raw SQL was read in full. Each redundancy below is anchored to `file:line`. Baseline verified: **66 test files / 603 tests green**, app typechecks (the only `typecheck` error is a pre-existing untracked scratch file `scratch_check_db.ts`, not part of the app).
> **Goal:** a smooth, standards-compliant, **backward-compatible** path to remove redundant code, maximize reuse, and make the DB layer a single source of truth — without passing responsibilities around.

---

## 0. Executive Summary

The web-app data layer is **genuinely well-engineered**: a principled migration policy, a dedicated pgvector SQL module, centralized constants, and a clean tRPC router split. It is **not broken**. But it is **fragmented along accidental lines**, and the single worst pattern is the **row → domain mapping duplicated by hand in every consumer**.

The plan below is **100% code-level consolidation — zero schema changes, zero migrations** — so it is backward-compatible by construction and each phase is independently verifiable.

### Redundancy inventory (verified, with file:line)

| # | Redundancy | Location | Severity |
|---|-----------|----------|----------|
| R1 | **Row → `Chunk` mapping triplicated** — `id: String(row.id)`, `parentId → undefined`, `documentId → undefined`, `sourceName/url/text` | `db/vector-queries.ts:118-126`, `db/vector-queries.ts:217-225`, `rag/retrieval/corpus.ts:54-63` | **High** |
| R2 | **Vector-literal builder duplicated** — `toVectorLiteral()` exists at `db/vector-queries.ts:73` but `ingest/pipeline.ts:288` hand-rolls `` `[${vector.join(",")}]`::vector `` inline | `ingest/pipeline.ts:288` | Medium |
| R3 | **`make_interval(days => …)` time-window fragment repeated 6×** | `routers/admin.ts:302,364,389,441,485,520` | Medium |
| R4 | **`role = 'USER'` / `role = 'ASSISTANT'` filters repeated 4+×** in analytics | `routers/admin.ts:287,299,363,384,483,519` | Low |
| R5 | **Raw SQL scattered across routers** — 6 `$queryRaw` analytics blocks in `admin.ts`, 1 in `public.ts` | `routers/admin.ts:296-528`, `routers/public.ts:19` | Medium |
| R6 | **`responseJson` JSON-shaping duplicated** — `toCachedResponse`/`extractAnswer`/`extractSources` re-implement the cache-payload contract | `rag/cache/semantic-cache.ts:147-171` | Low |
| R7 | **`ensureOwnership` duplicated** — same 4-line conversation-ownership check in two routers | `routers/chat.ts:31-43`, `routers/conversation.ts:98-110` | Low |
| R8 | **Guest prompt-limit query repeated 3×** — identical `message.count({ role: USER, conversation deletedAt null })` | `routers/conversation.ts:129`, `routers/conversation.ts:434`, `routers/chat.ts:55`, + `api/chat/stream/route.ts:55` | Low |
| R9 | **Fallback sparse-retrieval orchestration** living inside `hybrid.ts` (WeakMap cache + BM25 fallback decision), competing with `vectorQueries.sparseSearch` | `rag/retrieval/hybrid.ts:27,80-104` vs `db/vector-queries.ts:191-226` | Design note |

### What is already correct (DO NOT touch)

- **`prisma/migrations/MIGRATION_POLICY.md`** — the HNSW divergence, enum-recreate pattern, additive-migration rules, and verification loop are excellent and **load-bearing**. Preserve in full.
- **`server/db.ts`** — the Prisma singleton is correct and idiomatic.
- **Constants in `rag/types.ts`** — `EMBEDDING_DIM`, `DENSE_TOP_K`, `SPARSE_TOP_K`, `RRF_K`, `CRAG_THRESHOLD`, `CACHE_*` are central and correct.
- **`db/vector-queries.ts` as the pgvector engine** — correctly owns `findSimilarChunks`, `findSimilarCacheEntry`, `upsertCacheEntry`, `sparseSearch`. This plan *builds on* it, never replaces it.
- **Semantic cache delegating to `vectorQueries`** — correct reuse; only its JSON accessors (R6) need polish.
- **Auth/guest/ownership security model** — guest HMAC signing, lazy provision, admin gate: all correct.

---

## 1. Current Architecture (as-built)

### 1.1 Data models (Prisma = single source of truth, `schema.prisma`)

- **Auth:** `User`, `Account`, `Session` (NextAuth v5 via `@auth/prisma-adapter`).
- **Conversations:** `Conversation` (soft-delete `deletedAt`), `Message`, `MessageFeedback`, `ConversationMemory`.
- **Knowledge base:** `Document`, `DocumentParentChunk`, `DocumentChunk` (True Parent-Child chunking, `vector(1024)`).
- **Diagnostics:** `PipelineRun`. **Jobs:** `IngestJob`. **Cache:** `SemanticCacheEntry`.

### 1.2 Data-access topology

```
        CONSUMERS (21 files import prisma)
  routers/{admin,chat,conversation,document,source,public}.ts
  rag/retrieval/{dense,hybrid,corpus,join}.ts
  rag/cache/semantic-cache.ts · rag/memory/summary-buffer.ts · rag/chat-pipeline.ts
  ingest/{jobs,pipeline}.ts · auth.ts · guest.ts · trpc/{context,t}.ts
  app/api/chat/stream/route.ts · app/api/cron/cleanup-cache/route.ts
        │
        ├── Prisma ORM (typed models)          ┌── Raw pgvector SQL
        ▼                                      ▼
   prisma client (db.ts)          db/vector-queries.ts (SINGLE SOURCE for vectors)
        │                                      │
        └───────────────┬──────────────────────┘
                        ▼
              PostgreSQL + pgvector
```

**Structural problem:** two dialects (Prisma objects vs. raw rows) with **no shared mapping layer**. The only thing that maps a raw chunk row into a domain `Chunk` is copy-paste (R1). The only thing that builds a vector literal is `toVectorLiteral`, except where it is re-inlined (R2).

### 1.3 Where raw SQL lives (complete)

| File | Raw SQL | Verdict |
|------|---------|---------|
| `db/vector-queries.ts` | `findSimilarChunks`, `findSimilarCacheEntry`, `upsertCacheEntry`, `sparseSearch` | **Correct** — vectors need raw SQL; centralized intentionally |
| `routers/admin.ts` | 6 `$queryRaw` analytics blocks (metrics, daily, mode-split, recent, top, failed) | **Accidental** — repeats time-window + role fragments; centralizable |
| `routers/public.ts` | 1 `$queryRaw` (German-chunk percentage) | **Accidental-ish** — single query, centralizable |
| `ingest/pipeline.ts` | `$executeRaw` bulk insert + inline vector literal | Bulk insert irreducible; inline literal is R2 |

### 1.4 DB model usage (complete)

| Model | Consumers |
|-------|-----------|
| `User` | auth, guest, trpc/t, admin(metrics/users), conversation(claim) |
| `Conversation` | conversation router (list/get/update/delete/count/stats/export), chat router, chat-pipeline, stream route |
| `Message` | chat router, conversation router, chat-pipeline, stream route, admin (analytics), summary-buffer |
| `MessageFeedback` | chat router (`feedback`), guest (`claimGuestFeedback`) |
| `ConversationMemory` | summary-buffer |
| `Document` | source router, document router, ingest pipeline, admin metrics, public stats |
| `DocumentParentChunk` | ingest pipeline, join.ts, public stats |
| `DocumentChunk` | vector-queries, corpus, source router, ingest pipeline, admin metrics, public stats |
| `PipelineRun` | admin (`testPipeline`, `listTestRuns`, `getTestRun`) |
| `IngestJob` | ingest jobs |
| `SemanticCacheEntry` | semantic-cache, cron cleanup |

---

## 2. The Improvement Plan (phased, smooth, non-destructive)

Each phase is a **pure refactor**: no schema change, no migration, no behavior change. Every phase ends with `pnpm typecheck && pnpm test && pnpm lint` green. The existing 603 tests are the safety net.

### Phase 1 — Introduce the repository layer (kills R1, R2, R5, R3, R4)

**Goal:** make `src/server/db/` the *only* place that maps rows to domain objects and issues raw SQL.

```
src/server/db/
  vector-queries.ts   (existing — keep as the raw pgvector engine)
  mapping.ts          (NEW — rowToChunk + cache-payload accessors)
  analytics.ts        (NEW — admin/public analytics, shared time-window fragment)
```

**1a. Extract row→`Chunk` mapping** (`mapping.ts`). This becomes the **one** place that knows how a DB row becomes a `Chunk`:

```ts
// src/server/db/mapping.ts
import type { Chunk } from "@/server/rag/types";

export interface ChunkRow {
  id: number | string;
  parentId?: number | string | null;
  documentId?: string | null;
  sourceName: string;
  sourceUrl: string;
  text: string;
  similarityScore?: number;
  bm25Score?: number;
}

export function rowToChunk(row: ChunkRow): Chunk {
  return {
    id: String(row.id),
    parentId: row.parentId == null ? undefined : String(row.parentId),
    documentId: row.documentId ?? undefined,
    sourceName: row.sourceName,
    sourceUrl: row.sourceUrl,
    text: row.text,
    ...(row.similarityScore !== undefined ? { similarityScore: row.similarityScore } : {}),
    ...(row.bm25Score !== undefined ? { bm25Score: row.bm25Score } : {}),
  };
}
```

Then update the three call sites to `rows.map(rowToChunk)`:
- `db/vector-queries.ts:118-126` → `rows.map(rowToChunk)`
- `db/vector-queries.ts:217-225` → `rows.map(rowToChunk)`
- `rag/retrieval/corpus.ts:54-63` → `rows.map(rowToChunk)`

**1b. Reuse `toVectorLiteral` (R2).** Export it from `vector-queries.ts` (already exported) and use it in `ingest/pipeline.ts:288`:

```ts
import { toVectorLiteral } from "@/server/db/vector-queries";
// ...
${toVectorLiteral(vector)}::vector,
```

**1c. Centralize analytics (R5/R3/R4).** Move the 6 admin `$queryRaw` blocks + the public German-percentage query into `db/analytics.ts`, returning domain objects. Add a shared `timeWindow(days?)` helper to kill the 6× `make_interval` repetition:

```ts
// db/analytics.ts
import { Prisma } from "@prisma/client";
const timeWindow = (days?: number) =>
  days ? Prisma.sql`AND "createdAt" >= NOW() - make_interval(days => ${days}::integer)` : Prisma.empty;

export async function messageStats(prisma, days?) { /* … */ }
export async function dailyQueries(prisma, days) { /* … */ }
export async function modeSplit(prisma, days?) { /* … */ }
export async function recentQueries(prisma, opts) { /* … */ }
export async function topQuestions(prisma, days) { /* … */ }
export async function failedQueries(prisma, opts) { /* … */ }
export async function germanChunkStats(prisma) { /* … */ }
```

`admin.ts`/`public.ts` become thin tRPC adapters over these. **Admin tRPC output types (`AdminMetrics`, `DailyQueryPoint`, etc.) are unchanged**, so the client contract is preserved exactly.

### Phase 2 — Extract conversation ownership + guest-limit (kills R7, R8)

**Goal:** one shared helper for the two most-repeated cross-cutting checks.

- Create `src/server/lib/conversation-policy.ts` with `ensureConversationOwnership(prisma, user, conversationId)` and `countGuestPromptsUsed(prisma, userId)`.
- Replace the duplicated `ensureOwnership` in `routers/chat.ts:31` and `routers/conversation.ts:98` and the duplicated guest-limit query in `conversation.ts:129`, `conversation.ts:434`, `chat.ts:55`, and `api/chat/stream/route.ts:55`.

### Phase 3 — RAG sparse-retrieval encapsulation (kills R9)

**Goal:** make the FTS-or-BM25 decision a single testable unit.

- Extract the `bm25IndexCache` WeakMap + fallback into `rag/retrieval/sparse-retriever.ts` (or fold into `db/`), so `hybrid.ts` stops carrying fallback orchestration. Keep `vectorQueries.sparseSearch` as the primary path and `BM25Okapi` as the pure fallback engine.

### Phase 4 — Cache payload typed accessor (kills R6)

- Move `extractAnswer`/`extractSources` into `db/mapping.ts` as `parseCachePayload(responseJson)` returning a typed `{ answer: string; sources: Source[] }`, so the `responseJson` contract is defined once and `semantic-cache.ts` reads through it.

### Phase 5 — Documentation & when to migrate

- Update `MIGRATION_POLICY.md` "Related reading" to point at the new `db/` repository layer as the canonical data-access home.
- **No schema change in this pass.** Future schema changes must follow the existing `MIGRATION_POLICY.md` (§3 additive, §4 enum-recreate, §5 checklist) — which is already excellent and needs no modification.

---

## 3. Reusability & DRY principles applied

| Principle | Applied as |
|-----------|-----------|
| Single source of truth | `db/` owns all raw SQL + all row→domain mapping |
| Don't pass it around | A consumer needing a `Chunk` calls `rowToChunk`/`vectorQueries`, never re-maps |
| Reuse over rewrite | `toVectorLiteral` reused (R2); `timeWindow` shared across analytics (R3); `ensureConversationOwnership`/`countGuestPromptsUsed` shared (R7/R8) |
| Testability | `mapping.ts` and `analytics.ts` are pure/unit-testable without a DB |

---

## 4. Risk & Guardrail assessment

**Risk tier:** Commercial/Production (deployed chat + admin app).

- **No destructive DB op** in any phase — schema, tables, data untouched. Backward-compatible by construction.
- **No shortcuts** — every phase ends with `typecheck + test + lint` green; no `@ts-ignore`, no empty catches.
- **Client contract preserved** — tRPC output types and `Chunk`/`Source`/`ChatMessage` shapes unchanged.
- **Load-bearing code preserved** — `MIGRATION_POLICY.md`, `db.ts`, `vector-queries.ts`, `rag/types.ts` constants, guest/security model.

---

## 5. Execution order & effort

| Order | Phase | Effort | Risks |
|-------|-------|--------|-------|
| 1 | 1a — `mapping.ts` + 3 call sites (R1) | 0.5–1 day | Low — pure refactor, tests assert Chunk shape |
| 2 | 1b — reuse `toVectorLiteral` (R2) | <0.5 day | Low |
| 3 | 1c — `analytics.ts` (R5/R3/R4) | 1–2 days | Medium — 6 duplicated fragments |
| 4 | 2 — ownership + guest-limit (R7/R8) | 0.5–1 day | Low |
| 5 | 3 — sparse-retriever (R9) | 0.5–1 day | Low–Medium |
| 6 | 4 — cache payload accessor (R6) | 0.5 day | Low |
| 7 | 5 — docs | 0.25 day | None |

**Total: ~3–5 dev-days**, non-destructive, each phase independently shippable.

---

## 6. What to preserve (load-bearing)

1. **`MIGRATION_POLICY.md` in full** — do not "fix" the HNSW divergence; it is intentional and documented.
2. **`prisma/db.ts` singleton** — correct.
3. **Constants in `rag/types.ts`** — correct single source.
4. **`vector-queries.ts` as the pgvector engine** — the foundation this plan builds on.
5. **Semantic-cache delegation** — already correct; Phase 4 only polishes its JSON accessors.
6. **Guest/security model** — HMAC signing, lazy provision, admin gate.