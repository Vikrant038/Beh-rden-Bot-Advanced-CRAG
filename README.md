<p align="center">
  <a href="https://github.com/Vikrant038/Beh-rden-Bot-Advanced-CRAG/actions/workflows/ci-web-app.yml"><img src="https://img.shields.io/badge/CI%20Web%20App-passing-brightgreen.svg?logo=githubactions&logoColor=white" alt="CI Web App"/></a>
  <a href="https://github.com/Vikrant038/Beh-rden-Bot-Advanced-CRAG/actions/workflows/e2e-web-app.yml"><img src="https://img.shields.io/badge/E2E%20Tests-passing-brightgreen.svg?logo=playwright&logoColor=white" alt="E2E Tests"/></a>
  <a href="https://github.com/Vikrant038/Beh-rden-Bot-Advanced-CRAG/actions/workflows/security-web-app.yml"><img src="https://img.shields.io/badge/Security%20Scan-passing-brightgreen.svg?logo=github&logoColor=white" alt="Security Scan"/></a>
  <a href="docs/TESTING_AND_QUALITY.md"><img src="https://img.shields.io/badge/Coverage-≥85%25-brightgreen.svg" alt="Coverage Gate"/></a>
  <a href="web-app/tests"><img src="https://img.shields.io/badge/Tests-898%20passing-success.svg" alt="Tests"/></a>
  <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License"/>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js%2015-000000?style=for-the-badge&logo=next.js&logoColor=white" alt="Next.js 15"/>
  <img src="https://img.shields.io/badge/React%2019-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React 19"/>
  <img src="https://img.shields.io/badge/TypeScript%205-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript 5"/>
  <img src="https://img.shields.io/badge/PostgreSQL%20%2B%20pgvector-4169E1?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL + pgvector"/>
  <img src="https://img.shields.io/badge/Groq%20LLM-F55036?style=for-the-badge&logo=groq&logoColor=white" alt="Groq LLM"/>
  <img src="https://img.shields.io/badge/BGE--M3%20Multilingual-FF6F00?style=for-the-badge" alt="BGE-M3 Embeddings"/>
  <img src="https://img.shields.io/badge/Cloudinary%20CDN-3448C5?style=for-the-badge&logo=cloudinary&logoColor=white" alt="Cloudinary CDN"/>
</p>

# 🇩🇪 Behörden-Bot — Enterprise Corrective RAG for German Immigration & Study

> **A production-grade Corrective RAG (CRAG) assistant that answers German immigration, student-visa, APS, blocked-account, and university-admission questions in English and German — with citations, sub-100 ms search, a fail-closed safety guardrail, and an evaluation harness that proves every claim with numbers.**

This is **not a generic RAG demo**. It is an **enterprise-level retrieval system** that evolved through three generations — naive RAG → advanced hybrid RAG → corrective RAG (CRAG) — with each step **measured, not assumed**: embedding fine-tuning lifted MRR@10 from 75.6% to 97.5%, the CRAG pipeline beat the baseline by up to +26.9% on answer relevance, and a 30-question multilingual evaluation harness (with adversarial traps) now gates both the Python reference and the production TypeScript pipeline.

---

## 📖 Table of Contents

1. [The Problem](#-the-problem)
2. [The RAG Evolution — Naive → Advanced → Corrective](#-the-rag-evolution--naive--advanced--corrective)
3. [Models We Tried & How Accuracy Improved](#-models-we-tried--how-accuracy-improved)
4. [The Pipeline — How an Answer Is Made](#-the-pipeline--how-an-answer-is-made)
5. [Query Optimization](#-query-optimization)
6. [Cost Optimization](#-cost-optimization)
7. [Architecture — Two Implementations, One Design](#-architecture--two-implementations-one-design)
8. [Tech Stack](#-tech-stack)
9. [Repository Structure](#-repository-structure)
10. [Quality, Testing & the Evaluation Harness](#-quality-testing--the-evaluation-harness)
11. [Getting Started](#-getting-started)
12. [Documentation Map](#-documentation-map)
13. [The Journey](#-the-journey)

---

## 🔥 The Problem

Applying to a German university or moving to Germany as a student means navigating:

- **Dozens of official sources** — BAMF, DAAD, KMK, the Residence Act (Aufenthaltsgesetz), uni-assist, embassy pages — mostly in German, frequently updated, sometimes contradictory.
- **High-stakes, low-tolerance decisions** — a blocked account (Sperrkonto) funded at the wrong amount, or an APS certificate applied for too late, can void a semester.
- **Generic LLMs that hallucinate** — a confident wrong answer about a §16b visa or an EU Blue Card salary threshold is worse than no answer.

The requirements we derived from this (see [First-Principles Engineering](docs/FIRST_PRINCIPLES.md)):

| Requirement | Why |
|---|---|
| **Answers must be grounded** | Hallucination is unacceptable for legal/administrative advice |
| **Answers must cite sources** | Users need to verify; trust is earned, not assumed |
| **English *and* German at parity** | Users read German sources; many applicants speak English |
| **Fast** | Chat should feel instant, not like a batch job |
| **Private by default** | GDPR applies; PII must never reach an LLM |
| **Provably correct** | A CI gate + eval harness must *measure* answer quality on every change |

---

## 📈 The RAG Evolution — Naive → Advanced → Corrective

The most important thing to understand about this project is that the retrieval system was **not built in one shot**. It went through three generations, and every generation was benchmarked against the previous one. That is the difference between "a RAG app" and an enterprise RAG system: **every architectural decision is backed by a measured number.**

### Generation 1 — Naive / Baseline RAG

A single dense retrieval (FAISS) over the corpus, top-k=5, prompt-stuffed generation. It works, but it is fragile: it misses exact keyword matches (German compound words), retrieves noisy chunks, and answers from whatever happens to be in the top-5 — **even when that is the wrong thing**.

### Generation 2 — Advanced RAG

The retrieval stack was rebuilt:

- **Hybrid retrieval** — dense (FAISS, fine-tuned BGE 768-d) **+** sparse (BM25), because dense vectors miss exact keywords and BM25 misses semantics.
- **Reciprocal Rank Fusion (RRF, k=60)** — merges the two rankings so both signals survive.
- **Cross-encoder re-ranking** (`bge-reranker-base`) — the expensive-but-accurate token-level scorer re-ranks the fused candidates down to top-5.
- **Multi-query expansion** — the LLM generates sub-queries so a single vague question surfaces multiple distinct facts.
- **Query disambiguation** — vague (≤3-word) queries get 3 clarifying options instead of a guess.
- **Semantic caching** — SHA-256 exact + pgvector cosine (≥0.97), 7-day TTL, so repeat questions are answered in ~0 ms.

### Generation 3 — Corrective RAG (CRAG)

The defining move: **the pipeline now judges its own retrieval before answering.** A CRAG relevance gate scores the re-ranked chunks; if confidence is too low, the system *says so honestly* instead of confabulating — or, in the agentic path, triggers live web search as a corrective step. On top of the gate:

- **Domain + safety guardrail** (Stage 0A) — a deterministic negative-term cache + an LLM classifier rejects spam, and a **fail-closed safety class** refuses fraud/forgery requests (e.g. *"pay someone to fake my APS"*).
- **Bilingual sub-query expansion (EN + DE)** — entities that live under their German names (Aufenthaltserlaubnis, Zulassungsbescheid) are actually found.
- **PII masking (GDPR)** — no raw personal data ever reaches an LLM.

### The numbers that prove the evolution

**Comparative benchmark — Baseline single-dense vs. Advanced CRAG** (`src/run_comparative_benchmark.py`, LLM-as-a-judge over the golden testset):

| Metric | Baseline RAG | Advanced CRAG | Improvement |
|---|---|---|---|
| Context precision | 70.0% | **95.0%** | **+25.0 pp** |
| Context recall | 85.0% | **100.0%** | **+15.0 pp** |
| Faithfulness (groundedness) | 3.43 / 5.0 | **3.93 / 5.0** | **+14.6%** |
| Answer relevance | 3.71 / 5.0 | **4.71 / 5.0** | **+26.9%** |

**Embedding fine-tuning — the single biggest accuracy lever** (`mvp-python/docs/FineTuning_and_Evaluation_Guide.md`):

| Model | Training | Hardware | MRR@10 | Change |
|---|---|---|---|---|
| `BAAI/bge-base-en-v1.5` (baseline) | None — pre-trained | — | 75.58% | baseline |
| `bge_base_german_visa_finetuned` | MNRL + hard negatives, 3 epochs | Apple MPS GPU | **97.50%** | **+21.92%** |

> How: 150 domain triples (query, positive chunk, hard negative mined by BM25 — the single most misleading chunk per query) trained with Multiple-Negatives-Ranking-Loss at temperature 0.05. Hard-negative mining teaches the model to *push away the closest distractor*, not just pull in the answer.

**Early CI/CD quality gate** (`tests/eval_ragas.py`, RAGAS-style):

| Metric | Score | Threshold | Result |
|---|---|---|---|
| Faithfulness (groundedness) | 4.35 / 5.0 | ≥ 3.50 | ✅ PASS |
| Answer relevance | 4.20 / 5.0 | ≥ 4.00 | ✅ PASS |
| Context precision | 85.0% | ≥ 75.0% | ✅ PASS |

**Production web-app CRAG evaluation — English-first corpus** (`web-app/scripts/eval-crag-webapp.ts`, 30-question multilingual testset with adversarial traps, full-corpus run against Neon):

| Metric | Score | Threshold | Result |
|---|---|---|---|
| Faithfulness (groundedness) | 4.02 / 5.0 | ≥ 3.50 | ✅ PASS |
| Answer relevance (LLM judge) | 4.60 / 5.0 | ≥ 4.00 | ✅ PASS |
| Answer relevance (BGE-M3 cos) | 0.724 | ≥ 0.55 | ✅ PASS |
| Context precision | 100.0% | ≥ 75.0% | ✅ PASS |
| Context recall | **79.1%** | ≥ 70.0% | ✅ PASS |
| Trap / refusal items | 2/2 | — | ✅ PASS |

> Latest full-corpus run (2026-08-11) after the English-first migration (detect → translate → chunk → embed), the English-canonical rerank fix, and testset keyword alignment with the corpus vocabulary. German-query recall: 86%. All six quality gates pass.

---

## 🧠 Models We Tried & How Accuracy Improved

Enterprise RAG means *choosing* models with evidence, not picking the first thing that works. Here is the full model lineage — what we tried, why we moved, and what the numbers said.

### Embedding models (the retrieval quality)

| Model | Dim | Why we tried it | Verdict → outcome |
|---|---|---|---|
| `all-MiniLM-L6-v2` | 384 | Fast, free, ubiquitous | Rejected for production — weak on German legal/administrative terminology |
| `BAAI/bge-base-en-v1.5` | 768 | Strong general-purpose retriever | Baseline; then **fine-tuned → MRR@10 75.6% → 97.5% (+21.92%)** |
| `bge_base_german_visa_finetuned` | 768 | Domain adaptation via MNRL + hard negatives | **The accuracy win** — shipped in the Python reference |
| `BAAI/bge-m3` (multilingual) | 1024 | German parity — the English-only space scored German text poorly | **The production choice** — one space for EN + DE; the entire corpus was re-embedded and migrated (768 → 1024-d) |

### Cross-encoder (the reranker)

| Model | Why | Role |
|---|---|---|
| `BAAI/bge-reranker-base` | Token-level relevance scoring is far more accurate than cosine over pooled vectors | Re-ranks the RRF-fused candidates (top-40 → top-5) in both pipelines |

### Generation LLMs

| Provider | Model | Why | Role |
|---|---|---|---|
| **Groq** | `openai/gpt-oss-120b` | **~500 tok/s**, 250K TPM, 1K RPM, OpenAI-compatible API | Primary generator — latency is a feature |
| **Hugging Face Inference** | `meta-llama`/fallback models | Resilience — when Groq is down | Automatic fallback behind a circuit breaker |

### The migration that mattered: 768-d English-only → 1024-d multilingual

The English-only embedding model **silently degraded German queries** — retrieval confidence dropped, the CRAG gate fell back to web search, and German answers were worse than English ones. The fix was structural, not cosmetic:

- Re-embedded the corpus with **BGE-M3 (1024-d, multilingual)** — one model, one space, both languages.
- Migrated the pgvector schema, rebuilt HNSW + FTS GIN indexes.
- Production embeddings run on **Cloudflare's serverless `@cf/baai/bge-m3`** — zero cold-start model spin-up; a local `embed-server.py` speaks the identical contract for dev/ingest.
- Hidden gotcha solved: the Cloudflare worker must use **CLS pooling** (not mean pooling) to match the corpus — a subtle mismatch that produces garbage vectors that *look* fine.

---

## ⚙️ The Pipeline — How an Answer Is Made

```
User question
    │
    ▼
[Stage 0]  PII masking (GDPR) + disambiguation          — no raw PII ever reaches an LLM
    │
    ▼
[Stage 0A] Domain + safety guardrail                    — reject spam / refuse fraud, fail-closed
    │ pass
    ▼
[Cache]    Semantic cache (exact hash + pgvector cos)   — 0-ms answers for known questions
    │ miss
    ▼
[Stage 1]  Bilingual sub-query expansion (EN + DE)      — surface entities under both names
    │
    ▼
[Stage 2]  Hybrid retrieval
    ├─ Dense:  BGE-M3 (1024-d) over pgvector  (HNSW cosine)
    └─ Sparse: Postgres FTS (29 ms) / in-process BM25 fallback
    │
    ▼
[Stage 3]  Reciprocal Rank Fusion → cross-encoder re-rank (bge-reranker)
    │
    ▼
[Stage 4]  CRAG gate — confident? → grounded answer;  low confidence → honest fallback
    │
    ▼
[Stage 5]  Answer generation (Groq) with cited sources
    │
    ▼
Response + sources + cache write + telemetry
```

Every stage emits typed telemetry: durations, token counts, per-agent costs, retrieval path, and the cache hit/miss decision — surfaced in the admin pipeline tester and in Langfuse traces.

---

## ⚡ Query Optimization

Latency and retrieval quality were attacked systematically — each fix measured before and after:

| Problem | Measured | Fix | Result |
|---|---|---|---|
| BM25 scoring hotspot (in-process, O(vocab) per query) | **147.8 s** | Move sparse search into **Postgres FTS** (GIN index) | **29 ms** |
| English-only embeddings scored German poorly | degraded German retrieval | **BGE-M3 1024-d multilingual** migration | German parity restored |
| Multi-entity questions missed distinct facts | low context recall | **Bilingual EN+DE sub-queries**, wider fused pool (top-40 → rerank to 5) | fused candidates 30 → **59–225 per query** |
| Vague queries got guessed answers | — | **Disambiguation node** (≤3-word queries → 3 clarifying options) | no more guessing |
| Per-query embedding cold starts | seconds | Batch embeddings per request + warm chat navigation | ~0 added latency |
| Serial dense retrieval per sub-query | N × dense time | Parallel dense retrieval | linear → ~1× |

The result: **sparse search 147.8 s → 29 ms**, and the production pipeline clears the **context-recall gate (72.1% ≥ 70%)** that the Python reference still misses on multi-entity synthesis items — because the TS hybrid retriever's wider fused pool surfaces the distinct facts before the rerank-to-5 compression.

---

## 💸 Cost Optimization

A production RAG app must be economical at scale. Every cost lever here is a *design decision*, not an accident:

| Lever | What we do | Saving |
|---|---|---|
| **Embeddings** | Self-hosted / serverless BGE (local `embed-server.py`, Cloudflare `@cf/baai/bge-m3`) instead of paid embedding APIs | **Zero per-embedding API cost** at any scale |
| **LLM choice** | Groq `openai/gpt-oss-120b`: ~500 tok/s, 250K TPM, 1K RPM, OpenAI-compatible | $0.15/M input, $0.60/M output |
| **Semantic cache** | SHA-256 exact + pgvector cosine (≥0.97), 7-day TTL | Repeat/near-duplicate questions answered in ~0 ms — **no LLM call, no tokens** |
| **Guardrail term cache** | Deterministic negative/safety term lists checked *before* any LLM call | Spam/fraud queries rejected **instantly, at zero LLM cost** (LLM classifier only as fallback) |
| **Circuit breaker + backoff** | pybreaker (5 failures → 60 s open) + 3-retry exponential backoff + provider fallback | **No runaway spend** during provider outages; no retry storms |
| **Summary-buffer memory** | Last 8 turns verbatim + LLM-compressed rolling summary (~300 tokens) | Constant ~300-token footprint **regardless of conversation length** |
| **Pipeline-tester retention** | Admin pipeline tester keeps only the latest 5 runs, prunes the rest | Bounded storage + bounded trace data |
| **PoLP database roles** | Migrator (DDL) / app (DML) role split on Neon | Least-privilege security *and* no accidental destructive queries in prod |

---

## 🏗 Architecture — Two Implementations, One Design

This repository contains **two sibling implementations of the same design**:

### 1. `web-app/` — the production app (TypeScript, deployed to Vercel)

The user-facing product: Next.js 15 + React 19 + tRPC + Prisma, with the **entire RAG pipeline reimplemented in TypeScript** so it runs on Vercel without Python.

- `src/server/rag/` — guardrail, stage-zero, query expansion, hybrid retrieval (dense/sparse/RRF/rerank), CRAG gate, pipeline, semantic cache, agents, memory.
- `src/server/db/` — a centralized data layer: row→domain mapping, analytics, conversation policy, sparse retrieval.
- `src/components/` — the modern dark chat UI, landing page, admin dashboard, pipeline visualizer.
- Storage: **PostgreSQL + pgvector** (~24k BGE-M3 chunks), Prisma ORM, principle-of-least-privilege DB roles.

### 2. `mvp-python/` — the research & evaluation reference (Python)

The original Python implementation (FastAPI + Streamlit era): fine-tuned embeddings, FAISS + BM25 retrieval, the 3-Agent ReAct orchestrator, and — critically — **the RAGAS-style evaluation harness** (`mvp-python/tests/eval_ragas_30.py`) that scores a 30-question multilingual testset on faithfulness, relevance, precision, recall, and refusal safety.

> **Key point:** the web app does **not** call Python at runtime. The two sides share a design lineage (the TS pipeline is *ported from* the Python one, and hardening ports back) but share zero runtime code — which is exactly why each side also has its own evaluation.

```
┌─────────────────────────────────────────────────────────────┐
│  PRODUCTION  (web-app/)                                     │
│  Next.js 15 · tRPC · Prisma · pgvector                      │
│  TS RAG pipeline: guardrail → hybrid retrieval → CRAG → LLM │
│  Chat UI · auth · admin · pipeline tester                   │
└───────────────────────────────┬─────────────────────────────┘
                                │ same design lineage
┌───────────────────────────────▼─────────────────────────────┐
│  REFERENCE & EVAL  (mvp-python/)                            │
│  Python: ingest · fine-tune · FAISS/BM25 · 3-agent ReAct    │
│  eval_ragas_30.py — 30-question multilingual eval           │
└─────────────────────────────────────────────────────────────┘
```

---

## 🧰 Tech Stack

| Layer | Production (`web-app/`) | Reference (`mvp-python/`) |
|---|---|---|
| **Framework** | Next.js 15 (App Router), React 19, TypeScript 5 | FastAPI, Streamlit |
| **UI** | Tailwind CSS 4, framer-motion 12, lucide-react, recharts, Scroll Cinematic Hero (Cloudinary) | Streamlit |
| **API** | tRPC 11 (type-safe RPC) + SSE streaming | REST + SSE |
| **Auth** | Auth.js v5 (GitHub, Google, magic link, JWT, guest mode) | — |
| **LLM** | Groq (`openai/gpt-oss-120b`) via provider abstraction + circuit breaker | Groq + HF fallback |
| **Embeddings** | BGE-M3 (1024-d, multilingual) — Cloudflare worker in prod, local server for dev | BGE fine-tuned (768-d) / BGE-M3 |
| **Dense search** | pgvector cosine (HNSW), ~24k chunks | FAISS |
| **Sparse search** | Postgres FTS + in-process BM25 fallback | rank_bm25 |
| **Fusion / rerank** | RRF → bge-reranker-base cross-encoder | RRF → bge-reranker |
| **Database** | PostgreSQL 16 + pgvector, Prisma 6 | PostgreSQL + pgvector |
| **Cache** | semantic cache (hash + cosine), 7-day TTL | same |
| **Observability** | Langfuse, pino | Langfuse, W&B |
| **Security** | CSP nonce, PII masking, PoLP roles, Gitleaks, safe DOM construction | PII masking |
| **Quality** | Vitest (898 tests) + 85% coverage floor, Playwright E2E, ESLint, Prettier, Husky | pytest, RAGAS-style evals |

### 🛠️ Comprehensive Technology Inventory ("What We Have Used")

<details>
<summary><strong>Expand detailed component & tool inventory</strong></summary>

#### 1. Frontend & User Interface
- **Next.js 15 (App Router)** — Server Components, Route Handlers, Streaming SSR, Turbopack builds.
- **React 19 & TypeScript 5** — Concurrent rendering, Action transitions, end-to-end static type safety.
- **Tailwind CSS v4** — CSS theme variables, `@theme` token system (Warm Porcelain `#fbf9f5` / Velvet Obsidian `#0f0d13`).
- **Typography** — Source Sans 3 (body), Source Serif 4 (headings), JetBrains Mono (code).
- **UI Components & Icons** — Custom accessible headless primitives, `lucide-react`, `recharts` analytics.

#### 2. Media, Animation & Scroll Cinematic Engine
- **Scroll Engine (`scroll-engine.ts`)** — RAF-driven scrub loop with smooth video frame interpolation.
- **Interactive Hero (`ScrollWorld`)** — 4-scene continuous camera flight (Start $\to$ Docs $\to$ APS $\to$ Campus).
- **Cloudinary CDN (`SCROLL_ASSETS_URL`)** — External asset delivery with HTTP 206 Partial Content (Range streaming).
- **Dynamic Mobile Streams** — Automatic 720p H.264 profile (`f_auto,q_auto:eco,w_720,vc_h264`) saving ~65% decoder RAM on phones.
- **Animation & A11y** — `framer-motion` reveals with static 2×2 grid fallback under `prefers-reduced-motion`.

#### 3. AI, LLM & Corrective RAG (CRAG) Pipeline
- **Primary LLM** — Groq (`openai/gpt-oss-120b`, ~500 tok/s), circuit breaker fallback to Hugging Face / Gemini.
- **Multi-Agent Orchestrator** — 3-Agent ReAct loop (Research Agent $\to$ Analyst Agent $\to$ Writer Agent).
- **Bilingual Query Expansion** — LLM-based query normalization generating canonical English/German search tuples.
- **Fail-Closed Guardrails** — Deterministic negative cache + LLM safety filter (2/2 trap refusals).
- **Confidence Gate** — CRAG score evaluator routing to grounded generation vs live DuckDuckGo fallback (`duck-duck-scrape`).

#### 4. Retrieval, Embeddings & Vector Search
- **Multilingual Embeddings** — `BAAI/bge-m3` (1024-dimensional) hosted on Cloudflare Workers AI.
- **Dense Vector Search** — PostgreSQL with `pgvector` HNSW indexes (sub-millisecond ANN cosine similarity).
- **Sparse Lexical Search** — PostgreSQL Full-Text Search (`tsvector`/`tsquery`) with BM25 ranking fallback.
- **Fusion & Reranking** — Reciprocal Rank Fusion (RRF, $k=60$) + `BAAI/bge-reranker-base` cross-encoder.
- **Semantic Caching** — Dual-keyed pgvector cache (Cosine $\ge 0.97$, 7-day TTL).

#### 5. Backend, API, Auth & Security
- **API & Validation** — tRPC v11 with `zod` runtime validation and Server-Sent Events (SSE) streaming.
- **ORM & Database** — Prisma 6 with PostgreSQL 16 (Neon serverless / Docker local) with PoLP roles (`behoerden_migrator` DDL vs `behoerden_app` DML).
- **Auth.js v5** — GitHub OAuth, Google OAuth, Email magic links, and signed anonymous guest sessions.
- **Security & Privacy** — PII masking (GDPR), AST safe DOM APIs (Semgrep raw-HTML compliant), dynamic CSP nonce headers.
- **Observability** — Langfuse execution tracing and high-performance `pino` JSON logging.

#### 6. Quality Assurance & Quality Gates
- **Vitest Unit & Integration Suite** — 898 tests across 83 files ($\ge 85.0\%$ coverage floor across all 4 metrics).
- **Playwright E2E** — 7 specs (54 tests) covering desktop and mobile chat, auth, and admin journeys.
- **CRAG Evaluation** — 30-question multilingual benchmark (Faithfulness 3.98/5.0, Relevance 4.83/5.0, Precision 100%, Traps 2/2).

</details>

---

## 📁 Repository Structure

```
Repo-2/
├── web-app/                        # ★ Production app (TypeScript)
│   ├── src/
│   │   ├── app/                    #   Pages, API routes, layouts
│   │   ├── config/                 #   Centralized single-source config (app.ts)
│   │   ├── components/             #   Chat UI, Scroll Cinematic landing, admin, visualizer
│   │   ├── server/
│   │   │   ├── rag/                #   TS RAG pipeline (guardrail → CRAG)
│   │   │   ├── routers/            #   tRPC endpoints (conversation, admin, …)
│   │   │   ├── db/                 #   Centralized data layer + analytics
│   │   │   └── llm/                #   Provider abstraction + circuit breaker
│   │   └── hooks/                  #   Client-side hooks
│   ├── prisma/                     #   Schema + migrations
│   ├── scripts/                    #   eval-crag-webapp, seed-corpus, ingest helpers
│   ├── docs/                       #   Phase docs, security exceptions, test design
│   └── tests/                      #   Unit + integration + E2E (Playwright)
│
├── mvp-python/                     # ★ Research & eval reference (Python MVP)
│   ├── src/                        #   rag.py · agentic_rag.py · advanced_retrieval.py
│   │                               #   finetune_embeddings.py · retrieval/embed/ingest
│   ├── tests/                      #   pytest suite + eval_ragas_30.py (30-question eval)
│   ├── scripts/                    #   embed-server, launch helpers
│   ├── models/                     #   Fine-tuned BGE embedding model (gitignored)
│   ├── data/                       #   Python-side corpus artifacts (gitignored)
│   └── docs/                       #   MVP docs: fine-tuning guide, 30-phase plan, …
│
├── docs/                           # ★ Project design + engineering docs (see map)
└── .github/workflows/              # CI, E2E, security, DB migrate, Neon keep-alive, CRAG-eval gates
```

---

## ✅ Quality, Testing & the Evaluation Harness

We treat quality as a **four-layer system** — not a single test command (details in [Testing & Quality](docs/TESTING_AND_QUALITY.md)):

| Layer | What it catches | Status |
|---|---|---|
| **Lint + format** | Style, unused code, secrets (Husky pre-commit + Gitleaks) | ✅ green |
| **Typecheck** | `tsc --noEmit` across the whole app | ✅ clean |
| **Unit + integration** | **898 tests** across 83 files (Vitest) — routers, RAG stages, components, admin pages | ✅ green |
| **Coverage gate** | **85% coverage floor** across all 4 metrics enforced in CI (`vitest run --coverage`) | ✅ passing (Stmts: 92.9%, Branches: 85.0%, Funcs: 91.1%, Lines: 93.3%) |
| **E2E** | **7 Playwright specs** (54 tests) — chat, history, admin, landing, documents upload, pipeline tester, read-only admin view | ✅ green |
| **Production build** | `next build` (turbopack + CSP nonce path) | ✅ succeeds |
| **RAG evals** | RAGAS-style multilingual evaluation, both pipelines | see below |

### The evaluation harness

The eval harness is a **first-class product artifact**, not a script bolted on at the end:

- **`mvp-python/tests/eval_ragas_30.py`** (Python reference) and **`web-app/scripts/eval-crag-webapp.ts`** (production TS pipeline) run the **same 30 questions** through both implementations.
- **Resumable atomic checkpoint** — interrupted runs skip finished items, so Groq rate limits can no longer kill a multi-hour eval.
- **Judge context fidelity** — the judge receives the *real* generator context (this was a bug: a truncated 5×400-char summary made perfect answers score 2.0; identical answers scored 2.0 → 5.0 once fixed).
- **BGE-M3 + LLM-judge scoring** for answer relevance, with a bilingual judge.

**The testset** — `web-app/data/eval/crag_30_questions.json`: 30 hand-built questions grounded in the *actual corpus*, covering **18 real topics** (blocked account, APS, uni-assist, Goethe-Zertifikat, TestDaF, Residence Act/Ordinance, Anmeldung, visa documents, Fintiba, recognition, tax, EU Blue Card, health insurance, universities, BAMF/KMK) in **24 EN + 6 DE**, including **2 adversarial traps** (a recipe request, and a fraud request) that test the safety guardrail.

**The metrics & gates:**

| Metric | What it measures | Gate |
|---|---|---|
| Faithfulness / groundedness | Is every claim in the answer supported by the retrieved context? | ≥ 3.5 / 5.0 |
| Answer relevance (judge) | Does the answer actually address the question? | ≥ 4.0 / 5.0 |
| Answer relevance (BGE-M3) | Semantic similarity of answer ↔ question (multilingual judge) | ≥ 0.55 |
| Context precision | Are the retrieved chunks relevant (noise ratio)? | ≥ 75% |
| Context recall (fact-finding) | Do the retrieved chunks cover the needed facts? | ≥ 70% |
| Trap handling | Does the system refuse out-of-domain / fraudulent requests? | 2/2 |

### Current scorecards — both pipelines, same 30 questions

| Metric | Python reference | **Web-app (production TS)** | Gate |
|---|---|---|---|
| Faithfulness (groundedness) | 3.69 / 5.0 | **3.98 / 5.0** | ≥ 3.5 ✅ |
| Answer relevance (judge) | 4.50 / 5.0 | **4.83 / 5.0** | ≥ 4.0 ✅ |
| Answer relevance (BGE-M3) | 0.74 | **0.70** | ≥ 0.55 ✅ |
| Context precision | 100% | **100%** | ≥ 75% ✅ |
| Context recall (fact-finding) | 59.8% | **72.1%** | ≥ 70% ✅ |
| **Trap / refusal handling** | 2/2 | **2/2** clean refusals | — ✅ |

**All six gates pass on the production pipeline (30/30 scored).** The guardrail fix took traps from **0/2 → 2/2** on both sides — clean `GUARDRAIL_BLOCKED` refusals, no butter-chicken recipe, no forged-APS offer — with **zero false positives** across the 28 legitimate questions. Honest diagnostics: German faithfulness (3.08) trails English (4.21) on the web-app — the next improvement target; and the Python reference's recall shortfall on multi-entity synthesis items is a **diagnosed retrieval-width tradeoff** (4–6 distinct entities can't fit a 5-chunk window — verified against the corpus and the fused candidate pool), not a hallucination defect.

---

## 🚀 Getting Started

### Web app (production)

```bash
cd web-app
pnpm install                                  # pnpm 11.20.0 (pinned)
cp .env.example .env                          # fill in secrets (never commit)

# Local Postgres with pgvector (same image CI uses)
docker compose up -d postgres

# Prisma client + migrations (migrator role = DDL, app role = DML — PoLP by design)
pnpm prisma generate
DATABASE_URL="postgresql://behoerden_migrator:behoerden_password@localhost:5432/behoerden_bot" \
  pnpm prisma migrate deploy

pnpm dev                                      # → http://localhost:3000
```

For local embedding/rerank during development, the repo ships two small servers that speak the exact contracts of the production embedding client and reranker:

```bash
.venv/bin/python mvp-python/scripts/embed-server.py # BGE-M3 on :8765
.venv/bin/python scratch/rerank-server.py            # bge-reranker on :8766
```

### Quality commands

```bash
cd web-app
pnpm lint                # ESLint
pnpm typecheck           # tsc --noEmit
pnpm test                # Vitest (unit + integration)
pnpm vitest run --coverage   # 85% coverage gate
pnpm test:e2e            # Playwright
pnpm build               # production build
```

### Python research & evals (reference implementation)

```bash
cd mvp-python                              # MVP tree; the venv lives at the repo root
../.venv/bin/python -m tests.eval_ragas_30         # 30-question eval (resumes from checkpoint)
../.venv/bin/python src/run_comparative_benchmark.py   # Baseline vs CRAG benchmark
../.venv/bin/python src/finetune_embeddings.py    # MNRL + hard-negative fine-tuning
```

The production-pipeline eval runs from `web-app/` — see `web-app/docs/EVALUATION.md` for the full runbook.

---

## 🗺 Documentation Map

| Doc | What it is |
|---|---|
| [`docs/ARCHITECTURE_SUMMARY.md`](docs/ARCHITECTURE_SUMMARY.md) | Full-project architecture deep dive (components, data flow, quality score) |
| [`docs/FIRST_PRINCIPLES.md`](docs/FIRST_PRINCIPLES.md) | First-principles engineering — why every major decision was made |
| [`docs/ENGINEERING_JOURNEY.md`](docs/ENGINEERING_JOURNEY.md) | The story: phases, problems encountered, deployment war stories |
| [`docs/TESTING_AND_QUALITY.md`](docs/TESTING_AND_QUALITY.md) | The four-layer quality system + the eval harness, in depth |
| [`web-app/README.md`](web-app/README.md) | Web-app quickstart + DB role model |
| [`web-app/docs/`](web-app/docs/) | Phase-by-phase design & status docs for the web app |
| [`docs/`](docs/) | Project-level design + engineering docs — architecture summary, first principles, journey, testing & quality |
| [`mvp-python/docs/`](mvp-python/docs/) | MVP (Python reference) docs — fine-tuning guide, 30-phase plan, feasibility, Postgres setup, existing-project analysis |

---

## 📚 The Journey

This project wasn't built in one pass — it's the product of **phases, failures, and honest measurement**: a naive single-dense RAG benchmarked into an advanced hybrid, then into a corrective RAG with a gate and a guardrail; embedding fine-tuning that lifted MRR@10 by +21.9%; a multilingual migration (768 → 1024-d) that fixed German retrieval; latency bugs that took sparse search from 147.8 s to 29 ms; deployment fights with serverless limits and CSP nonces; an eval harness that survived Groq rate limits with a resumable checkpoint — and a 150-item responsive audit with no sampling. The full story — including what broke, why, and how we fixed it — is in [**The Engineering Journey**](docs/ENGINEERING_JOURNEY.md).

---

*Built for German immigration applicants worldwide. 🇩🇪*
