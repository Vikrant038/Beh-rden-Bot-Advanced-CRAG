# Existing Project Analysis — Behoerden-Bot 3.0

> **Project:** Enterprise 3-Agent ReAct RAG + Domain Fine-Tuned Embeddings for German Immigration, Student Visa, APS Certification, and University Applications  
> **Status:** Analyzed  
> **Source Code:** `/Users/vikranty/Documents/Project/OLD Lap Work/Repo-2/` (DO NOT MODIFY)  
> **Generated:** 2026-07-31

---

## 1. Executive Summary

**Behoerden-Bot 3.0** is a production-grade RAG system answering questions about German immigration, student visas, APS certification, university applications, blocked accounts, health insurance, and housing registration for Indian students.

**Core Architecture:** 3-Agent ReAct orchestrator + hybrid retrieval (FAISS + BM25 + RRF + Cross-Encoder) + CRAG relevance gate with DuckDuckGo web-search fallback + domain fine-tuned BGE embeddings + PostgreSQL/pgvector persistence + semantic caching + summary-buffer memory + GDPR PII masking + Langfuse v4 observability.

**Knowledge Base:** 21 curated sources (18 web + 3 PDF), scraped and chunked into ~400 segments (chunk_size=600, overlap=150). Embedding model: `BAAI/bge-base-en-v1.5` fine-tuned on 150 domain triples (MNRL loss + hard negatives), improving MRR@10 from 75.6% to 97.5%. LLM: Groq `llama-3.1-8b-instant` with HuggingFace fallback behind circuit breaker.

### Key Benchmarks

| Metric | Baseline Single-Dense | Advanced CRAG |
|---|---|---|
| Faithfulness | 3.43 / 5.0 | 3.93 / 5.0 |
| Answer Relevance | 3.71 / 5.0 | 4.71 / 5.0 |
| Context Precision | 70.0% | 95.0% |
| Context Recall | 85.0% | 100.0% |

### CI/CD Quality Gate (hard thresholds)

| Metric | Threshold | Current |
|---|---|---|
| Faithfulness | >= 3.50 | 4.35 |
| Answer Relevance | >= 4.00 | 4.20 |
| Context Precision | >= 75.0% | 85.0% |

---

## 2. Repository Structure

```
Repo-2/
├── .env.example              # Template for env vars (gitignored .env)
├── .env                      # Local secrets (gitignored)
├── .github/workflows/rag_eval_ci.yml  # CI quality gate (33 lines)
├── .streamlit/config.toml    # Streamlit server/theme config (13 lines)
├── requirement.txt           # 130-line pip freeze (exact local versions)
├── requirements.txt          # 23-line minimal deps (used by CI)
├── docker-compose.yml        # PostgreSQL + pgvector container
├── app.py                    # Streamlit UI entrypoint
├── api.py                    # FastAPI backend (REST + SSE)
├── migrate.py                # Database migration entry point
├── README.md                 # 534 lines — comprehensive documentation
├── AGENTS.md                 # Agent operations guide
├── src/                      # Core RAG pipeline (20 Python modules)
├── data/                     # Sources, raw text, processed artifacts
├── models/                   # Fine-tuned embedding model (437MB)
├── tests/                    # 8 test/eval files
└── Docs/                     # 5 documentation files
```

### Source Modules (src/)

| File | Purpose | Key Classes/Functions |
|---|---|---|
| `agentic_rag.py` | 3-Agent ReAct orchestrator | AgenticRAG, ResearchAgent, AnalystAgent, WriterAgent |
| `advanced_retrieval.py` | Hybrid retrieval, CRAG gate, guardrails | CRAGGate, MultiQueryExpander, DomainGuardrail, QueryDisambiguator |
| `retrieval.py` | Dense + sparse retrieval + RRF | HybridRetriever, DenseRetriever, BM25Retriever, RRFFusion |
| `rag.py` | Baseline single-agent RAG (benchmark) | BaselineRAG, rag_query() |
| `llm_client.py` | Multi-provider LLM with resilience | LLMClient, GroqLLM, HuggingFaceLLM, CircuitBreaker |
| `pii_masker.py` | GDPR PII redaction | PIIMasker, mask_pii() |
| `semantic_cache.py` | Multi-tier cache (SHA-256 + pgvector) | SemanticCache |
| `memory.py` | Summary-buffer conversational memory | SummaryBufferMemory |
| `database.py` | SQLAlchemy async models | DocumentChunk, CacheEntry, Conversation, Message |
| `document_sync.py` | Zero-downtime doc sync | DocumentSync |
| `tracing.py` | Langfuse v4 OTel tracing | Tracer, setup_langfuse() |
| `embed.py` | BGE embedding pipeline | load_embedding_model(), embed_chunks() |
| `ingest.py` | Web scrape + PDF extract to chunks | ingest_pdf(), ingest_web(), chunk_text() |
| `finetune_embeddings.py` | MNRL fine-tuning (MPS GPU) | Fine-tune BGE on domain triples |
| `utils.py` | Pydantic config, NFC cleaning | Settings, ChunkModel, clean_text() |
| `errors.py` | Custom exceptions | RAGError, RetrievalError, LLMError |
| `logging_config.py` | Structured logging | setup_logging() |
| `migrate_to_postgres.py` | SQLite to Postgres migration | MigrationManager |
| `generate_testset.py` | Synthetic eval dataset | generate_test_questions() |
| `run_comparative_benchmark.py` | Baseline vs CRAG comparison | run_benchmark() |

---

## 3. Architecture Overview

### Full Pipeline

```
User Query (Streamlit UI or FastAPI)
    |
    v
[PII Masking — regex + spaCy NER]
    |
    v
[Stage 0A: Domain + Safety Guardrail]  — blocks off-topic / illegal advice
    | PASS
    v
[Stage 0B: Query Disambiguation]       — vague <=3-word queries -> 3 options
    | CLEAR
    v
[Semantic Cache Check]  — SHA-256 exact + pgvector cosine >= 0.97
    | MISS
    v
[Stage 1: Multi-Query Expansion]       — LLM generates 3 sub-queries
    |
    v
[Stage 2: Hybrid Retrieval]
   +-- Dense: FAISS (Fine-tuned BGE 768d, min sim 0.20, k=15)
   +-- Sparse: BM25 (rank_bm25 Okapi, k=15)
    |
    v
[Stage 3: Reciprocal Rank Fusion (RRF, k=60)]
    |
    v
[Stage 4: Cross-Encoder Re-Rank (bge-reranker-base, top_k=5)]
    |
    v
[CRAG Check: cross_score >= 0.50?]
   +-- PASS  -> 3-Agent ReAct Pipeline
   +-- FAIL  -> Live Web Search (DDGS) -> 3-Agent ReAct Pipeline
    |
    v
3-AGENT REACT ORCHESTRATOR
   +-- Agent 1: Research Agent (ReAct loop with tools)
   +-- Agent 2: Analyst Agent (5-dim comparison matrix -> Pydantic)
   +-- Agent 3: Writer Agent (Executive Markdown synthesis)
    |
    v
Response + Sources + Metadata -> Save to PostgreSQL (cache + memory)
```

### 3-Agent ReAct Orchestrator

1. **Research Agent** — ReAct loop: Thought -> Action(FAISS search / Web search / visa_calculator) -> Observation.
2. **Analyst Agent** — Produces structured Pydantic object: summary, structured_table, key_insights, verified_facts.
3. **Writer Agent** — Executive Markdown: bold summary, comparison table, key insights, mandatory disclaimer, source citations.

### Hybrid Retrieval

| Stage | Component | Config | Output |
|---|---|---|---|
| Dense | FAISS IndexFlatIP | Fine-tuned BGE 768d, min_sim=0.20, k=15 | Top-15 vectors |
| Sparse | BM25 Okapi | rank_bm25, k=15 | Top-15 keyword matches |
| Fusion | RRF | k=60 | Fused ranking |
| Re-rank | Cross-Encoder | bge-reranker-base, top_k=5 | Top-5 reranked |
| CRAG Gate | Threshold | score >= 0.50 | Pass -> agents / Fail -> DDGS web search |

### Fine-Tuned Embeddings

- **Base:** `BAAI/bge-base-en-v1.5` (768d, 12-layer BERT)
- **Loss:** MultipleNegativesRankingLoss + Hard Negatives
- **Data:** 150 domain triples (query, positive, hard negative)
- **Hardware:** Apple MPS GPU, 3 epochs, batch=16
- **Result:** MRR@10 75.6% -> 97.5% (+21.92%)
- **Output:** `models/bge_base_german_visa_finetuned/` (437MB safetensors)

---

## 4. Knowledge Base Inventory

### Sources (21 total)

**Web Sources (18):**

| ID | Name | Topic |
|---|---|---|
| aps-001 | APS India — Process for Indian Applicants | APS Certificate |
| aps-002 | APS India — Official Homepage | APS Certificate |
| aps-003 | APS India — Document Checklists | APS Checklist |
| aps-004 | APS India — dMAT Exam Details | APS dMAT Exam |
| daad-001 | DAAD Study Scholarships | Scholarships |
| mig-001 | Make it in Germany — Student Visa | Student Visa |
| mig-002 | Germany Visa — Student Visa from India | Student Visa |
| mig-003 | MyGermanUniversity — Student Visa | Student Visa |
| bamf-001 | BAMF — Study in Germany Guide | Study in Germany |
| app-001 | Uni-Assist Application Process | Uni-Assist Application |
| app-002 | RWTH Aachen — Master Application | RWTH Aachen Application |
| app-003 | TU Berlin — International Applicants | TU Berlin Application |
| fin-001 | Expatrio — Blocked Account Guide | Blocked Account (Sperrkonto) |
| fin-002 | Studying in Germany — Cost of Living | Cost of Living |
| health-001 | International Student Health Insurance | Health Insurance |
| health-002 | Expatrio — TK International Student | TK Health Insurance |
| prac-001 | Housing & Address Registration (Anmeldung) | Housing & Registration |

**PDF Sources (3):**
- pdf-001: APS India — Merkblatt Verfahren Landesrecht (German/English)
- pdf-002: APS India — Leaflet Process P (Partnership)
- pdf-003: APS India — Leaflet Class XII Procedure

### Key Knowledge Domains

1. **APS Certificate** (aps-001, aps-002, aps-003, aps-004, pdf-001/002/003) — Process, fees (18,000 INR), timeline (3-12 weeks), exemptions (scholarship, PhD, exchange), dMAT (new 2026 requirement), document checklists.
2. **Student Visa** (mig-001, mig-002, mig-003) — Types of visas, costs (75 EUR), processing time (12 weeks), 10-step application process, required documents, residence permit conversion.
3. **University Applications** (app-001, app-002, app-003, bamf-001) — Uni-Assist, RWTH Aachen, TU Berlin requirements.
4. **Finances** (fin-001, fin-002) — Blocked account (992 EUR/month), DAAD scholarships, Expatrio.
5. **Health Insurance** (health-001, health-002) — TK student insurance, eHealth card.
6. **Practical** (prac-001) — Anmeldung (address registration), housing, tax ID, broadcasting fee.

### Processed Artifacts

| File | Description |
|---|---|
| `all_chunks.json` | All ~400 chunks with text + metadata |
| `embeddings.npy` | 768-d embedding matrix |
| `faiss_index.bin` | FAISS IndexFlatIP vector index |
| `chunk_metadata.json` | Chunk metadata (source info + text) |
| `semantic_cache.json` | Pre-warmed cache entries |
| `golden_20_questions.json` | 20 hand-curated Q&A pairs for evaluation |
| `synthetic_eval_dataset.json` | 10 SYN-Q pairs (SYN-01 to SYN-10) with ground truth context + answer |
| `baseline_rag_results.json` | 15 baseline RAG results (Q01-Q15) |
| `advanced_crag_results.json` | 15 advanced CRAG results (Q01-Q15) |

---

## 5. API Surface

### FastAPI Backend (`api.py`)

| Endpoint | Method | Description |
|---|---|---|
| `/query` | POST | Main RAG query endpoint (SSE streaming + sync modes) |
| `/documents/sync` | POST | Zero-downtime transactional document sync + cache invalidation |
| `/health` | GET | Health check |

**POST /query Request body:**
- `query` (string, required): User question (max 1000 chars, PII auto-masked)
- `session_id` (string, default "default"): Conversational memory session key
- `user_id` (string, default "anonymous"): Langfuse trace attribution
- `stream` (bool, default true): SSE streaming vs synchronous JSON
- `mode` (string, default "agentic"): "agentic" (3-agent ReAct) or "standard" (CRAG)
- `bypass_cache` (bool, default false): Skip semantic cache

### Streamlit Frontend (`app.py`)

- Dual-mode: Standard CRAG / 3-Agent ReAct
- Sidebar: source viewer, cache info, trace viewer
- Dark theme: primaryColor `#4338ca` on `#0f172a` background
- Chat history with citations

---

## 6. Testing & Quality Gates

### CI/CD Quality Gate (`.github/workflows/rag_eval_ci.yml`)

- Triggers on push/PR to main/master
- Installs requirements.txt + spaCy model
- Runs `python -m tests.eval_ragas`
- Must pass all 3 thresholds (Faithfulness >= 3.50, Relevance >= 4.00, Precision >= 75.0%)

### Local Tests

| File | Purpose |
|---|---|
| `tests/eval_ragas.py` | CI/CD quality gate (RAGAS metrics) |
| `tests/eval_trulens.py` | Local TruLens dashboard (chunk 400 vs 600) |
| `tests/test_rag_quality.py` | 8 in-scope + 3 out-of-scope behavioral tests |
| `tests/test_rag_triad.py` | Retrieval -> Generation -> Evaluation triad |
| `tests/test_embeddings.py` | Embedding similarity ranking sanity checks |
| `tests/test_hf_client.py` | HuggingFace client fallback tests |
| `tests/test_tracing.py` | Langfuse tracing integration tests |
| `tests/test_document_sync.py` | Document sync API integration tests |

---

## 7. Infrastructure & Environment

### Environment Variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `HF_TOKEN` | Yes | — | HuggingFace model downloads |
| `GROQ_API_KEY` | Yes | — | Primary LLM (llama-3.1-8b-instant) |
| `LANGFUSE_PUBLIC_KEY` | Optional | — | Tracing |
| `LANGFUSE_SECRET_KEY` | Optional | — | Tracing |
| `LANGFUSE_HOST` | Optional | cloud.langfuse.com | Tracing endpoint |
| `WANDB_API_KEY` | Optional | — | Weave eval tracking |
| `DATABASE_URL` | Optional | localhost:5432 | Postgres connection |

### Dependencies (`requirements.txt` — 23 lines)

Key packages: streamlit, groq, sentence-transformers, faiss-cpu, rank_bm25, pydantic, python-dotenv, huggingface_hub, numpy, trafilatura, pdfplumber, ddgs, fastapi, uvicorn, psycopg2-binary, pgvector, sqlalchemy, asyncpg, pybreaker, langfuse, openai, weave, wandb.

### Docker Compose

Single service: `postgres` using `ankane/pgvector:v0.5.1`, port 5432, DB: behoerden_bot.

### Database Schema

| Table | Purpose | Key Columns |
|---|---|---|
| `document_chunks` | Document fragments | id, source_id, source_name, source_url, text, embedding (vector(768)) |
| `semantic_cache` | Cached query results | query_hash, query_embedding, response, similarity_score, created_at |
| `conversations` | Session metadata | session_id, user_id, created_at |
| `messages` | Conversational memory | conversation_id, role, content, metadata, created_at |

---

## 8. Key Parameters & Thresholds

| Component | Parameter | Value | File |
|---|---|---|---|
| Chunking | chunk_size | 600 chars | ingest.py |
| Chunking | chunk_overlap | 150 chars | ingest.py |
| Dense Retrieval | min_similarity | 0.20 | retrieval.py |
| Dense Retrieval | top_k | 15 | retrieval.py |
| BM25 Retrieval | top_k | 15 | advanced_retrieval.py |
| RRF Fusion | k | 60 | advanced_retrieval.py |
| Cross-Encoder | top_k | 5 | advanced_retrieval.py |
| CRAG Gate | threshold | 0.50 | agentic_rag.py |
| Semantic Cache | cosine threshold | 0.97 | semantic_cache.py |
| Semantic Cache | TTL | 7 days | semantic_cache.py |
| LLM | max_retries | 3 | llm_client.py |
| LLM | base_delay | 1.0s | llm_client.py |
| LLM | semaphore | 10 concurrent | llm_client.py |
| Circuit Breaker | failure threshold | 5 | llm_client.py |
| Circuit Breaker | reset timeout | 60s | llm_client.py |
| Memory | verbatim turns | last 8 messages | memory.py |
| Memory | summary footprint | ~300 tokens | memory.py |

---

## 9. Critical Design Decisions (from README.md)

1. **3 agents instead of 1 prompt** — Single-prompt overload degrades each task. Decoupled agents enforce structured Pydantic output per stage and independent Langfuse span visibility.
2. **Fine-tune BGE instead of OpenAI embeddings** — BGE runs locally for zero cost. Fine-tuning on immigration-specific triples gave +21.92% MRR@10.
3. **Hybrid BM25 + dense instead of dense-only** — Dense vectors miss exact keyword matches for German compound words. BM25 misses semantic similarity. RRF fusion gives both.
4. **PostgreSQL + pgvector instead of Pinecone** — Free at scale. Unifies vectors, cache, and memory in one database.
5. **Summary-buffer memory instead of full history** — Constant ~300 token footprint regardless of conversation length.
6. **Langfuse instead of LangSmith** — MIT-licensed, self-hostable (GDPR), OTel standard spans.
7. **Regex + spaCy for PII instead of LlamaGuard** — LlamaGuard needs 8B params — impossible on Render free tier. Structured PII handled by regex, names by spaCy en_core_web_sm (12MB).
8. **Groq instead of OpenAI** — 800 tok/s vs ~50-80. 14,400 free requests/day. OpenAI-compatible API.

---

## 10. What to Preserve in the New Implementation

These are the core business logic and knowledge elements that MUST be carried over to the new web app:

1. **Knowledge Base Content** — All 21 sources' text content in `data/raw/*.txt` and processed chunks in `data/processed/`.
2. **3-Agent ReAct Architecture** — Research -> Analyst -> Writer pipeline with Pydantic structured output.
3. **Hybrid Retrieval** — FAISS (dense) + BM25 (sparse) + RRF fusion + Cross-Encoder re-ranking.
4. **CRAG Gate** — Threshold 0.50, web search fallback when retrieval confidence is low.
5. **PII Masking** — Regex patterns for IBAN, passport, DOB, phone, email; spaCy NER for names.
6. **Semantic Cache** — SHA-256 exact match + pgvector cosine similarity (>= 0.97), 7-day TTL.
7. **Summary-Buffer Memory** — Last 8 messages verbatim + LLM-compressed rolling summary (~300 tokens).
8. **Domain Guardrail** — Stage 0A classifier blocking off-topic / illegal advice requests.
9. **Query Disambiguation** — Stage 0B catching vague queries and presenting 3 clarifying options.
10. **Multi-Query Expansion** — LLM generates 3 sub-queries for broader retrieval coverage.
11. **Resilient LLM Client** — Groq with 3-retry exponential backoff, semaphore for rate limiting, circuit breaker (5 failures, 60s reset), HF fallback.
12. **Langfuse Observability** — Typed spans (chain, agent, tool, retriever, guardrail, generation), TTFT tracking, status levels, user/session attribution.
13. **All Environment Variables** — HF_TOKEN, GROQ_API_KEY, LANGFUSE_*, DATABASE_URL.
14. **Quality Thresholds** — Faithfulness >= 3.50, Answer Relevance >= 4.00, Context Precision >= 75.0%.
15. **Benchmark Questions** — golden_20_questions.json and synthetic_eval_dataset.json for evaluation.
16. **Zero-Downtime Document Sync** — Transactional chunk replacement + cache invalidation.

---

## 11. What to Modernize in the New App

The new web app should be rebuilt with modern full-stack patterns while preserving all core logic above:

1. **Frontend:** Replace Streamlit with a modern React/Vue/Next.js frontend with a better chat UI, citations, markdown rendering, and real-time streaming.
2. **Backend:** Consider a cleaner FastAPI architecture with better separation of concerns, potentially using Celery for background ingestion/embedding tasks.
3. **Modern Python:** Use async/await consistently, Pydantic v2 for all data models, proper dependency injection.
4. **Containerized Deployment:** Docker + Docker Compose for dev, Kubernetes-ready for production.
5. **Type Safety:** Full TypeScript backend and frontend type safety.
6. **Testing:** Comprehensive test suite including unit, integration, and eval tests.
7. **Documentation:** Modern API docs with OpenAPI/Swagger, comprehensive README.

---

## 12. Data Flow Summary

```
[21 Sources]
    |
    v
[ingest.py] -- Web scrape (trafilatura) + PDF (pdfplumber) --> data/raw/*.txt
    |
    v
[clean_text()] -- NFC normalization, remove boilerplate, normalize whitespace -->
    |
    v
[chunk_text()] -- RecursiveCharacterTextSplitter (chunk_size=600, overlap=150) --> all_chunks.json
    |
    v
[embed.py] -- BGE model encode (768d, L2-normalized) --> embeddings.npy
    |
    v
[retrieval.py] -- FAISS IndexFlatIP build --> faiss_index.bin
    |
    v
[migrate_to_postgres.py] -- Store chunks + embeddings in pgvector --> PostgreSQL
    |
    v
[query] -- Multi-query expansion -> FAISS + BM25 -> RRF -> Cross-Encoder -> CRAG gate -->
    |
    v
[3-Agent ReAct] -- Research -> Analyst -> Writer -->
    |
    v
[Response] -- PII-masked answer + sources + metadata --> Streamlit UI / FastAPI SSE
```

---

## 13. File Sizes & Scale

| Item | Size / Count |
|---|---|
| source files (all .txt) | ~20 files, ~30-200KB each |
| total raw text | ~2.5MB |
| chunks (all_chunks.json) | ~400 chunks, ~600 chars each |
| embeddings.npy | ~400 x 768 float32 (~1.2MB) |
| faiss_index.bin | ~300KB |
| semantic_cache.json | ~20 entries |
| fine-tuned model | 437MB (model.safetensors) |
| golden_20_questions.json | 20 Q&A pairs |
| synthetic_eval_dataset.json | 10 Q&A pairs |
| baseline_rag_results.json | 15 results (~362 lines) |
| advanced_crag_results.json | 15 results (~464 lines) |

---

## 14. Quickstart Commands

```bash
# All from: /Users/vikranty/Documents/Project/OLD Lap Work/Repo-2

# 0. Setup
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m spacy download en_core_web_sm

# 1. Start PostgreSQL + pgvector
docker-compose up -d postgres

# 2. Ingest & chunk
python src/ingest.py

# 3. Generate embeddings + FAISS index
python src/embed.py

# 4. Migrate to PostgreSQL
python src/migrate_to_postgres.py

# 5. Initialize database tables
python migrate.py

# 6. Run comparative benchmark
python src/run_comparative_benchmark.py

# 7. CI quality gate
python -m tests.eval_ragas

# 8. Launch Streamlit UI
streamlit run app.py --server.port 8501

# 8b. Or launch FastAPI backend
uvicorn api:app --host 0.0.0.0 --port 8000 --reload
```
