---
title: Behoerden Bot — German Immigration Assistant
emoji: 🇩🇪
colorFrom: indigo
colorTo: blue
sdk: streamlit
sdk_version: 1.41.0
app_file: app.py
pinned: false
---

# Behoerden-Bot 3.0 — Enterprise 3-Agent ReAct RAG System

> **A production-grade, open-source Corrective RAG (CRAG) and 3-Agent ReAct Orchestrator** for German immigration, student visas, APS certification, and university applications. Built with domain fine-tuned embeddings, hybrid retrieval, PostgreSQL/pgvector persistence, semantic caching, conversational memory, GDPR-compliant PII masking, and full Langfuse v4 observability.

[![CI/CD Quality Gate](https://github.com/Vikrant038/Beh-rden-Bot-Advanced-CRAG/actions/workflows/rag_eval_ci.yml/badge.svg)](https://github.com/Vikrant038/Beh-rden-Bot-Advanced-CRAG/actions)
![Python](https://img.shields.io/badge/python-3.11%2B-blue)
![LLM](https://img.shields.io/badge/LLM-Groq%20llama--3.1--8b-orange)
![Embeddings](https://img.shields.io/badge/Embeddings-BGE--base--768d%20fine--tuned-green)
![Database](https://img.shields.io/badge/DB-PostgreSQL%20%2B%20pgvector-blue)

---

## Table of Contents

1. [Architecture Overview](#-architecture-overview)
2. [Full Pipeline Stages](#-full-pipeline-stages)
3. [3-Agent ReAct Orchestrator](#-3-agent-react-orchestrator)
4. [Repository Structure](#-repository-structure)
5. [Tech Stack](#-tech-stack)
6. [Key Features](#-key-features)
7. [Benchmark Results](#-benchmark-results)
8. [Environment Variables](#-environment-variables)
9. [Local Setup](#-local-setup)
10. [Data Pipeline](#-data-pipeline)
11. [Evaluation and Quality Gates](#-evaluation--quality-gates)
12. [API Reference](#-api-reference)
13. [Deployment](#-deployment)
14. [Architectural Decisions](#-architectural-decisions)

---

## Architecture Overview

```
User Query (Streamlit UI / FastAPI)
    |
    v
[api.py] PII Masking (regex + spaCy NER)
    |
    v
[Stage 0A] Domain + Safety Guardrail  -- REJECT (off-topic / illegal advice)
    | PASS
    v
[Stage 0B] Query Disambiguation Node  -- CLARIFY (vague queries -> 3 options)
    | CLEAR
    v
Semantic Cache Check (SHA-256 Exact + pgvector Cosine >= 0.93)
    | MISS
    v
[Stage 1] Multi-Query Expansion (LLM generates 3 sub-queries)
    |
    v
[Stage 2] Hybrid Retrieval
   +-- Dense FAISS (Fine-tuned BGE 768d, min similarity 0.20, k=15)
   +-- Sparse BM25 (rank_bm25 Okapi, k=15)
    |
    v
[Stage 3] Reciprocal Rank Fusion (RRF, k=60)
    |
    v
[Stage 4] Cross-Encoder Re-Rank (BAAI/bge-reranker-base, top_k=5)
    |
    v
[CRAG Check] cross_score >= 0.50 ?
   +-- PASS  -> 3-Agent ReAct Pipeline
   +-- FAIL  -> Live Web Search (DDGS) -> 3-Agent ReAct Pipeline
    |
    v
3-AGENT REACT ORCHESTRATOR
   +-- Agent 1: Research Agent (ReAct tool loop)
   +-- Agent 2: Analyst Agent (5-dim comparison matrix)
   +-- Agent 3: Writer Agent (Executive Markdown synthesis)
    |
    v
Response + Sources + Metadata
    |
    v
Save to PostgreSQL Semantic Cache + Conversational Memory
```

---

## Full Pipeline Stages

| Stage | Name | Implementation | Purpose |
|-------|------|----------------|---------|
| Pre-flight | PII Masking | `src/pii_masker.py` | Strip IBAN, passport, DOB, phone, email, names before LLM |
| 0A | Domain + Safety Guardrail | `src/advanced_retrieval.py` | LLM classifier: blocks spam AND illegal advice requests |
| 0B | Query Disambiguation | `src/advanced_retrieval.py` | Catches vague <=3-word queries, presents 3 clarifying options |
| Cache | Semantic Cache | `src/semantic_cache.py` | Exact hash + pgvector cosine similarity (>=0.93, 7-day TTL) |
| 1 | Multi-Query Expansion | `src/advanced_retrieval.py` | LLM generates 3 sub-queries for broader retrieval coverage |
| 2 | Hybrid Retrieval | `src/retrieval.py` + `src/advanced_retrieval.py` | Dense FAISS + Sparse BM25 |
| 3 | RRF Fusion | `src/advanced_retrieval.py` | Reciprocal Rank Fusion (k=60) |
| 4 | Cross-Encoder Re-Rank | `src/advanced_retrieval.py` | BAAI/bge-reranker-base token-level scoring |
| CRAG | Relevance Gate | `src/agentic_rag.py` | Score >=0.50 uses retrieval; else triggers web search |
| Agents | 3-Agent ReAct | `src/agentic_rag.py` | Research -> Analyst -> Writer |
| Memory | Conversational Memory | `src/memory.py` | PostgreSQL summary-buffer (last 4 turns + rolling LLM summary) |

---

## 3-Agent ReAct Orchestrator

### Agent 1 — Research Agent

Runs a full ReAct (Reason + Act) loop with 3 tools:

| Tool | Langfuse Type | Purpose |
|------|---------------|---------|
| `vector_search` | `as_type="tool"` | Full hybrid pipeline: FAISS + BM25 + RRF + Cross-Encoder |
| `web_search` | `as_type="tool"` | DuckDuckGo DDGS (triggered for comparative/live/out-of-domain queries) |
| `visa_calculator` | `as_type="tool"` | Deterministic EUR/INR cost calculator for blocked accounts |

### Agent 2 — Analyst Agent

Produces a **5-dimension comparison matrix** as a structured Pydantic object `AnalystComparisonMatrix`:

- `summary` — high-level analytical answer
- `structured_table` — Markdown table (e.g. APS requirements by country)
- `key_insights` — list of key differences or important findings
- `verified_facts` — list of source-backed verified facts

### Agent 3 — Writer Agent

Executive Markdown synthesis:
- Bold executive summary answering the user query
- Embedded Markdown comparison table
- Key insights bullets
- Mandatory disclaimer

---

## Repository Structure

```
Behoerden-Bot-Advanced-CRAG/
|
+-- app.py                          # Streamlit UI (dual-mode: Standard CRAG / 3-Agent ReAct)
+-- api.py                          # FastAPI backend (SSE streaming + sync endpoints + PII masking)
+-- migrate.py                      # Database migration entry point
+-- docker-compose.yml              # PostgreSQL + pgvector local development container
+-- requirements.txt                # Production dependencies (pinned ranges, used by CI)
+-- requirement.txt                 # Full pip-freeze snapshot (exact reproducibility)
+-- .env.example                    # Template for all required secrets
+-- .github/
|   +-- workflows/
|       +-- rag_eval_ci.yml         # GitHub Actions CI/CD quality gate (on push/PR to main)
+-- data/
|   +-- sources.json                # 21 curated sources (18 web + 3 PDF)
|   +-- raw/                        # Scraped .txt files (21 documents)
|   +-- processed/
|       +-- faiss_index.bin         # FAISS vector index (fine-tuned BGE 768d)
|       +-- embeddings.npy          # Numpy embedding matrix
|       +-- chunk_metadata.json     # Chunk source/url/text metadata
|       +-- all_chunks.json         # All chunked documents (chunk_size=600, overlap=150)
+-- models/
|   +-- bge_base_german_visa_finetuned/   # Fine-tuned model weights (438MB safetensors)
+-- src/
|   +-- ingest.py                   # Web scrape (trafilatura) + PDF (pdfplumber) -> chunks
|   +-- embed.py                    # Embed chunks -> embeddings.npy + FAISS index
|   +-- retrieval.py                # Dense FAISS retrieval (BGE query prefix)
|   +-- advanced_retrieval.py       # BM25 + RRF + Cross-Encoder + Guardrail + Disambiguation
|   +-- rag.py                      # Standard CRAG pipeline (fallback/simple mode)
|   +-- agentic_rag.py              # 3-Agent ReAct orchestrator (primary production mode)
|   +-- llm_client.py               # Resilient LLM: Groq primary (circuit breaker) -> HF fallback
|   +-- semantic_cache.py           # Multi-tier cache: SHA-256 exact + pgvector cosine
|   +-- memory.py                   # Summary-buffer conversational memory (PostgreSQL-backed)
|   +-- database.py                 # SQLAlchemy async models: DocumentChunk, CacheEntry, Memory
|   +-- document_sync.py            # Zero-downtime transactional document update
|   +-- pii_masker.py               # GDPR PII masking: regex + spaCy NER (fails open)
|   +-- tracing.py                  # Langfuse v4 OTel tracing setup (observe, propagate_attributes)
|   +-- utils.py                    # Pydantic ChunkModel + German NFC text cleaning
|   +-- finetune_embeddings.py      # MNRL fine-tuning on MPS/CUDA, MRR@10 evaluation
|   +-- generate_testset.py         # Synthetic evaluation dataset generation
|   +-- run_comparative_benchmark.py  # Baseline RAG vs Advanced CRAG metric comparison
|   +-- migrate_to_postgres.py      # One-time: FAISS flat files -> PostgreSQL migration
+-- tests/
|   +-- eval_ragas.py               # CI/CD quality gate: Faithfulness + Relevance + Precision
|   +-- eval_trulens.py             # Local TruLens triad evaluation
|   +-- test_rag_quality.py         # 8 in-scope + 3 out-of-scope behavioral tests
|   +-- test_embeddings.py          # Embedding similarity ranking sanity checks
|   +-- test_rag_triad.py           # TruLens triad unit tests
|   +-- test_document_sync.py       # Document sync API integration tests
|   +-- test_hf_client.py           # HuggingFace client fallback tests
|   +-- test_tracing.py             # Langfuse tracing integration tests
+-- Docs/
    +-- Behoerden_Bot_30_Phase_Plan.md
    +-- FineTuning_and_Evaluation_Guide.md
    +-- RAG_Feasibility_Analysis.md
    +-- Repository_and_Model_Architecture_Reference.md
```

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| LLM | Groq `llama-3.1-8b-instant` | Primary LLM (14,400 req/day free, 800 tok/s) |
| LLM Fallback | HuggingFace Inference API | Automatic circuit-breaker failover |
| Embeddings | `BAAI/bge-base-en-v1.5` fine-tuned (768d) | Domain-specific vector encoding |
| Vector DB | FAISS (offline) + PostgreSQL pgvector (prod) | Dual-mode dense retrieval |
| Sparse Search | `rank_bm25` (Okapi BM25) | Keyword-based retrieval |
| Re-Ranker | `BAAI/bge-reranker-base` Cross-Encoder | Token-level relevance scoring |
| Database | PostgreSQL + pgvector + asyncpg | Cache, memory, document chunks |
| Web Framework | FastAPI + Uvicorn | Async REST API + SSE streaming |
| UI | Streamlit | Dual-mode chat interface |
| Observability | Langfuse v4 (OTel-based) | Span/cost/TTFT/status visibility |
| Web Search | DDGS (DuckDuckGo) | Live fallback for low-confidence retrieval |
| PII Protection | Regex + spaCy `en_core_web_sm` | GDPR input masking (zero GPU, 12MB) |
| Resilience | `pybreaker` Circuit Breaker | Auto-trip on 5 failures, reset in 60s |
| CI/CD | GitHub Actions | Automated RAG quality gate on every push |

---

## Key Features

### 1. Domain Fine-Tuned Embeddings (+21.92% MRR@10)
Fine-tuned `BAAI/bge-base-en-v1.5` using `MultipleNegativesRankingLoss` with hard negatives on Apple Silicon MPS GPU. MRR@10 improved from 75.6% to 97.5%.

### 2. Hybrid Retrieval (Dense + Sparse -> RRF -> Cross-Encoder)
Dense FAISS cosine search combined with Okapi BM25 keyword search, fused via Reciprocal Rank Fusion (k=60), then re-ranked by Cross-Encoder token-level cross-attention. Critical for German compound words (Aufenthaltserlaubnis, Zulassungsbescheid).

### 3. CRAG Relevance Gate
If the top re-ranked chunk scores below 0.50, the pipeline automatically triggers live DuckDuckGo web search before passing context to the agents. Ensures answers are always grounded even when the knowledge base is incomplete.

### 4. 3-Agent ReAct Orchestrator
Three fully decoupled agents, each with typed Langfuse spans: Research -> Analyst (Pydantic 5-dim matrix) -> Writer (Executive Markdown).

### 5. PostgreSQL + pgvector Persistence
Three production tables:
- `document_chunks` — Vector(768) embeddings
- `semantic_cache` — 768d cosine similarity cache, 7-day TTL
- `session_memory` — Conversational summary-buffer state

### 6. Multi-Tier Semantic Cache
Tier 1: SHA-256 exact hash (0ms). Tier 2: pgvector cosine similarity >=0.93 (near-duplicate). Negative cache for instant off-domain rejection. Cache invalidated on document sync.

### 7. Summary-Buffer Conversational Memory
Last 8 messages verbatim + older turns LLM-compressed into a rolling summary. Constant ~300 token footprint regardless of conversation length.

### 8. Langfuse v4 Full Observability
Every span typed with `as_type` (chain, agent, tool, retriever, guardrail, generation). TTFT auto-tracked via `langfuse.openai` wrapper. Status levels: DEFAULT (normal) / WARNING (graceful degradation) / ERROR (hard failure). user_id + session_id bound via `propagate_attributes()`.

### 9. GDPR-Compliant PII Masking
Runs at API entry point before any LLM call. Regex handles structured PII (IBAN, passport, DOB, phone, email). spaCy NER handles person names. Fails open. Logs `pii_detected=True` to Langfuse for monitoring.

### 10. Zero-Downtime Document Sync
`POST /documents/sync` transactionally replaces chunks (delete old -> embed new -> insert) and invalidates cache. No service interruption.

### 11. Resilient LLM Client
Groq with 3-retry exponential backoff + asyncio Semaphore(10) for rate limiting + pybreaker circuit breaker (trips on 5 failures) + automatic HF fallback. Stream semaphore guards only `create()`, not iteration — ensures `langfuse.openai` traced_iterator always finalizes (TTFT + token counts flushed).

---

## Benchmark Results

### Fine-Tuning: Embedding MRR@10

| Model | Training | Hardware | MRR@10 | Change |
|-------|----------|----------|--------|--------|
| `BAAI/bge-base-en-v1.5` (base) | None | Pre-trained weights | 75.58% | Baseline |
| `bge_base_german_visa_finetuned` | MNRL + Hard Negatives, 3 epochs | Apple MPS GPU | **97.50%** | **+21.92%** |

### CI/CD Quality Gate

| Metric | Score | Threshold | Status |
|--------|-------|-----------|--------|
| Faithfulness (Groundedness) | 4.35 / 5.0 | >= 3.50 | PASS |
| Answer Relevance | 4.20 / 5.0 | >= 4.00 | PASS |
| Context Precision | 85.0% | >= 75.0% | PASS |

### Baseline RAG vs. Advanced CRAG

| Metric | Baseline | Advanced CRAG | Improvement |
|--------|----------|---------------|-------------|
| Context Precision | 70.0% | 95.0% | +25.0% |
| Context Recall | 85.0% | 100.0% | +15.0% |
| Faithfulness | 3.43 / 5.0 | 3.93 / 5.0 | +14.6% |
| Answer Relevance | 3.71 / 5.0 | 4.71 / 5.0 | +26.9% |

---

## Environment Variables

Copy `.env.example` to `.env`:

```env
# LLM Providers
GROQ_API_KEY=gsk_...
HF_TOKEN=hf_...

# Langfuse Observability
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_HOST=https://cloud.langfuse.com

# PostgreSQL
POSTGRES_USER=behoerden_user
POSTGRES_PASSWORD=behoerden_password
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=behoerden_bot
```

---

## Local Setup

```bash
# 1. Clone repository
git clone https://github.com/Vikrant038/Beh-rden-Bot-Advanced-CRAG.git
cd Beh-rden-Bot-Advanced-CRAG

# 2. Create and activate virtual environment
python -m venv .venv && source .venv/bin/activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Install spaCy model for PII name masking (12MB, required)
python -m spacy download en_core_web_sm

# 5. Configure environment
cp .env.example .env
# Edit .env with your API keys and database credentials

# 6. Start PostgreSQL with pgvector
docker-compose up -d

# 7. Initialize database tables
python migrate.py

# 8a. Launch Streamlit UI
streamlit run app.py

# 8b. OR launch FastAPI backend
uvicorn api:app --host 0.0.0.0 --port 8000 --reload
```

---

## Data Pipeline

```bash
# 1. Scrape 21 sources -> data/raw/*.txt -> data/processed/all_chunks.json
python src/ingest.py

# 2. Embed chunks -> embeddings.npy + faiss_index.bin + chunk_metadata.json
python src/embed.py

# 3. Fine-tune BGE on domain data (MPS GPU, 3 epochs, ~2 min)
python src/finetune_embeddings.py

# 4. Migrate flat files to PostgreSQL (one-time, run after docker-compose up)
python src/migrate_to_postgres.py

# 5. Run comparative benchmark
python src/run_comparative_benchmark.py
```

---

## Evaluation and Quality Gates

### 3-Tier Architecture

```
Layer 3: Production Observability
  Langfuse v4 (OTel) — live traces in production
  Span cost, TTFT, tool calls, status levels
  user_id + session_id per request

Layer 2: CI/CD Automated Quality Gate
  tests/eval_ragas.py -> GitHub Actions on every push/PR
  Blocks merge if Faithfulness < 3.5
  Blocks merge if Answer Relevance < 4.0
  Blocks merge if Context Precision < 75%

Layer 1: Local Experimentation
  tests/eval_trulens.py — TruLens Groundedness/Relevance/Context triad
  Run manually during RAG development
```

### Commands

```bash
# CI/CD quality gate
python -m tests.eval_ragas

# Local TruLens evaluation
python -m tests.eval_trulens

# Unit tests
python -m pytest tests/test_rag_quality.py -v
python -m pytest tests/test_embeddings.py -v
python -m pytest tests/test_document_sync.py -v
python -m pytest tests/test_tracing.py -v
```

---

## API Reference

### POST /query

```json
{
  "query": "What are APS certificate requirements for Indian students?",
  "session_id": "session-abc123",
  "user_id": "student-vikrant",
  "stream": true,
  "mode": "agentic",
  "bypass_cache": false
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `query` | string | required | User question (max 1000 chars, PII auto-masked at API layer) |
| `session_id` | string | `"default"` | Conversational memory session key |
| `user_id` | string | `"anonymous"` | Langfuse trace attribution |
| `stream` | bool | `true` | SSE streaming (`true`) or synchronous JSON (`false`) |
| `mode` | string | `"agentic"` | `"agentic"` (3-agent ReAct) or `"standard"` (CRAG) |
| `bypass_cache` | bool | `false` | Skip semantic cache (for evaluation runs) |

**Streaming:** `text/event-stream` with `data: {"text": "..."}` chunks, final `data: {"done": true, "sources": [...]}`

### POST /documents/sync

```json
{
  "source_name": "DAAD Scholarships 2025",
  "source_url": "https://www.daad.de/...",
  "raw_text": "...",
  "source_id": "daad-2025"
}
```

Zero-downtime transactional chunk replacement + semantic cache invalidation. Runs in background task.

### GET /health

Returns `{"status": "healthy"}`.

---

## Deployment

### Streamlit Cloud (UI only)

1. Push to GitHub
2. Connect at share.streamlit.io
3. Set secrets: `GROQ_API_KEY`, `HF_TOKEN`, `LANGFUSE_*`, `POSTGRES_*`
4. App file: `app.py`

### Render (FastAPI + PostgreSQL)

1. Create PostgreSQL database on Render (pgvector supported natively)
2. Create Web Service from repo
   - Build: `pip install -r requirements.txt && python -m spacy download en_core_web_sm`
   - Start: `uvicorn api:app --host 0.0.0.0 --port $PORT`
3. Set all environment variables from `.env.example`
4. Run `python migrate.py` once via Render Shell

### Docker (Self-hosted)

```bash
docker-compose up -d
python migrate.py
uvicorn api:app --host 0.0.0.0 --port 8000
```

### Health Check

```bash
curl http://localhost:8000/health
curl -f http://localhost:8501/_stcore/health
```

---

## Architectural Decisions

**Why 3 agents instead of 1 prompt?**
Single-prompt overload causes the LLM to multitask — degrading each task. Decoupled agents enforce structured Pydantic output per stage and allow independent Langfuse span visibility.

**Why fine-tune BGE instead of OpenAI embeddings?**
OpenAI embeddings are paid and domain-agnostic. Fine-tuning on immigration-specific triples with Hard Negatives (MNRL loss) gave +21.92% MRR@10. BGE runs locally for zero cost.

**Why hybrid BM25 + dense instead of dense-only?**
Dense vectors miss exact keyword matches for German compound words. BM25 misses semantic similarity. RRF fusion gives both — critical for terms like Aufenthaltserlaubnis.

**Why PostgreSQL + pgvector instead of Pinecone?**
Pinecone/Weaviate are paid at scale. PostgreSQL is free on Render/Neon, supports native vector similarity via pgvector, and unifies vectors, cache, and memory in one database.

**Why summary-buffer memory instead of full history?**
Full history grows unbounded and overflows the LLM context window. Summary-buffer maintains constant ~300 token footprint: last 4 turns verbatim + older turns LLM-compressed.

**Why Langfuse instead of LangSmith?**
Langfuse is MIT-licensed, self-hostable (GDPR compliant), and v4 uses OTel standard spans — portable to any OTel backend. LangSmith is closed-source and paid-only.

**Why regex + spaCy for PII instead of LlamaGuard?**
LlamaGuard needs 8B parameters — impossible on Render free tier (512MB RAM). Structured PII (IBAN, passport, DOB, phone, email) is handled perfectly by regex at zero cost. spaCy en_core_web_sm (12MB) handles names via NER.

**Why Groq instead of OpenAI?**
800 tok/s vs ~50-80. 14,400 free requests/day. OpenAI-compatible API — langfuse.openai wraps it with zero code change.

---

## Known Gotchas

1. **Single requirements file:** `requirements.txt` is now the only file (exact pinned versions). Run `pip install -r requirements.txt` then `python -m spacy download en_core_web_sm`.
2. **Fine-tuned model auto-detected:** `retrieval.py` automatically loads `models/bge_base_german_visa_finetuned/` if the directory exists, falling back to base `BAAI/bge-base-en-v1.5` otherwise. No manual config change required.
3. **FAISS rebuild:** After re-embedding, run `python src/retrieval.py` to rebuild the index.
4. **DDGS import:** `from ddgs import DDGS` — package is `ddgs`, not `duckduckgo_search`.
5. **pgvector extension:** Enable before `migrate.py`. Docker uses `ankane/pgvector` (pre-installed). Render enables it via dashboard.
6. **Langfuse v4:** `propagate_attributes()` is the only valid way to set user_id/session_id. `update_current_trace()` does not exist in v4.
7. **spaCy model:** Must be downloaded separately: `python -m spacy download en_core_web_sm`.
8. **TTFT tracking:** Semaphore wraps only `create()`, not stream iteration — intentional to allow `langfuse.openai` traced_iterator to finalize and flush TTFT.

---

*Built for German immigration applicants worldwide.*
