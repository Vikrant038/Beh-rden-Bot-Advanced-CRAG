# Behoerden Bot (Repo-2) — AGENTS.md

> **Project:** Enterprise 3-Agent ReAct RAG + Domain Fine-Tuned Embeddings for German Immigration, Student Visa, APS, University Applications  
> **Stack:** Python 3.11+, Streamlit, FAISS, BM25, BGE Embeddings, Groq API, PostgreSQL+pgvector, RAGAS, Langfuse, Weights & Biases  
> **Architecture:** 3-Agent ReAct (Research → Analyst → Writer) + Stage-0 Query Disambiguation + Hybrid Retrieval (Dense + Sparse) + Cross-Encoder Re-Ranking + CRAG Fallback

---

## 🏗️ Repository Structure (Verified)

```
Repo-2/
├── .env.example                 # Required env vars (HF_TOKEN, GROQ_API_KEY, LANGFUSE_*, WANDB_*)
├── .env                         # Local secrets (gitignored — NEVER COMMIT)
├── .github/workflows/rag_eval_ci.yml  # CI gate: runs tests/eval_ragas.py on push/PR
├── .streamlit/config.toml       # Streamlit server config (port, CORS, etc.)
├── .venv/                       # Python 3.11 venv (gitignored)
├── requirement.txt              # Pinned deps (130 lines, pip freeze output)
├── requirements.txt             # Minimal deps (23 lines) — use this for CI
├── docker-compose.yml           # PostgreSQL + pgvector (ankane/pgvector:v0.5.1)
├── app.py                       # Streamlit entrypoint (multi-page app entry)
├── migrate.py                   # One-off migration script (SQLite → Postgres)
├── src/                         # Core RAG pipeline (see §3)
│   ├── __init__.py
│   ├── ingest.py                # Stage 1: PDF → chunks (JSONL)
│   ├── embed.py                 # Stage 2: Chunks → FAISS index (768-d BGE)
│   ├── retrieval.py             # Hybrid retrieval: FAISS + BM25 + RRF
│   ├── advanced_retrieval.py    # Cross-encoder re-ranker + CRAG gate
│   ├── rag.py                   # Baseline single-agent RAG (for benchmarking)
│   ├── agentic_rag.py           # 3-Agent ReAct orchestrator (main pipeline)
│   ├── llm_client.py            # Multi-provider LLM wrapper (Groq primary + HF fallback)
│   ├── pii_masker.py            # PII redaction (regex + spaCy)
│   ├── semantic_cache.py        # Semantic cache (embedding similarity)
│   ├── memory.py                # Conversation memory (LangChain)
│   ├── database.py              # Postgres + pgvector ops
│   ├── migrate_to_postgres.py   # SQLite → Postgres migration
│   ├── document_sync.py         # Incremental doc sync
│   ├── finetune_embeddings.py   # MNRL fine-tuning (MPS GPU, 3 epochs)
│   ├── generate_testset.py      # Synthetic testset generation
│   ├── run_comparative_benchmark.py  # Baseline vs CRAG comparison
│   ├── utils.py                 # Shared helpers
│   └── tracing.py               # Langfuse/Weave tracing setup
├── data/                        # Raw PDFs + processed chunks (gitignored)
├── models/                      # Fine-tuned embeddings + checkpoints (gitignored)
├── checkpoints/                 # Training checkpoints (gitignored)
├── tests/
│   ├── eval_ragas.py            # CI gate: Faithfulness≥3.5, Relevance≥4.0
│   ├── eval_trulens.py          # Local TruLens dashboard (chunk 400 vs 600)
│   ├── test_rag_quality.py      # Unit tests for retrieval quality
│   ├── test_rag_triad.py        # Retrieval → Generation → Evaluation triad
│   ├── test_embeddings.py       # Embedding sanity checks
│   ├── test_hf_client.py        # HF API client tests
│   ├── test_tracing.py          # Tracing integration tests
│   └── test_document_sync.py    # Incremental sync tests
└── docs/                        # Architecture diagrams, ADRs, eval reports
```

---

## ⚡ Quickstart (Exact Commands — Run in Order)

```bash
# 0. One-time setup
cd /Users/vikranty/Documents/Project/OLD\ Lap\ Work/Repo-2
python3 -m venv .venv && source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt          # Use minimal reqs for CI reproducibility

# 1. Start Postgres + pgvector (required for CRAG + fine-tuned embeddings)
docker-compose up -d postgres            # Port 5432, DB: behoerden_bot

# 2. Ingest & chunk source PDFs (German immigration docs)
python src/ingest.py                     # Output: data/chunks.jsonl

# 3. Generate 768-d embeddings + FAISS index
python src/embed.py                      # Output: data/faiss_index.bin, data/chunks_meta.jsonl

# 4. (Optional) Fine-tune BGE on domain triples — 3 epochs, MPS GPU, +21.92% MRR@10
python src/finetune_embeddings.py        # Output: models/bge_base_german_visa/

# 5. Run comparative benchmark (baseline RAG vs Advanced CRAG)
python src/run_comparative_benchmark.py  # Prints Table 3 from README

# 6. CI Quality Gate — MUST PASS before push
python -m tests.eval_ragas               # Faithfulness≥3.5, Relevance≥4.0, Context Precision≥75%

# 7. Launch Streamlit UI
streamlit run app.py --server.port 8501  # Opens http://localhost:8501
```

---

## 🔐 Environment Variables (Required)

| Variable | Required | Source | Purpose |
|----------|----------|--------|---------|
| `HF_TOKEN` | ✅ Yes | Hugging Face | Download BGE models, push fine-tuned model |
| `GROQ_API_KEY` | ✅ Yes | Groq Console | Primary LLM (llama-3.1-8b-instant, 14.4k req/day free) |
| `LANGFUSE_PUBLIC_KEY` | Optional | Langfuse Cloud | Production tracing (latency, tokens, fallbacks) |
| `LANGFUSE_SECRET_KEY` | Optional | Langfuse Cloud | Production tracing |
| `LANGFUSE_HOST` | Optional | Langfuse Cloud | Default: `https://cloud.langfuse.com` |
| `WANDB_API_KEY` | Optional | W&B | Weave evaluation tracking |
| `DATABASE_URL` | Optional | Local/Prod | Postgres URL (default: `postgresql://behoerden_user:behoerden_password@localhost:5432/behoerden_bot`) |

> **Never commit `.env`**. Copy `.env.example` → `.env` and fill secrets locally.

---

## 🧠 Core Architecture (What You Must Understand)

### 1. 3-Agent ReAct Pipeline (`src/agentic_rag.py`)

```
User Query
    │
    ▼
┌─────────────────────────────────────┐
│  Stage 0: Query Disambiguation      │  ← Catches vague queries ("When I move to Germany...")
│  (Classifier Node)                  │     Presents 3 clickable options → saves 90% tokens
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Hybrid Retrieval                   │  ← Dense (FAISS, BGE 768d) + Sparse (BM25)
│  → RRF Fusion                       │     Fused via Reciprocal Rank Fusion (k=60)
│  → Cross-Encoder Re-rank            │     Re-ranked by BAAI/bge-reranker-base
│  → CRAG Gate (score ≥ 0.50?)        │     If FAIL → Live Web Search (DDGS)
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Agent 1: Research Agent            │  ← ReAct loop: Thought → Action(FAISS/Web) → Observation
│  (Tool-calling, multi-hop)          │     Tools: faiss_search, web_search, visa_calculator
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Agent 2: Analyst Agent             │  ← 5-Dimension Comparative Matrix
│  (Structured extraction)            │     Dimensions: Requirements, Timeline, Cost, Risk, Alternatives
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Agent 3: Writer Agent              │  ← Executive Markdown synthesis
│  (Formatted response)               │     Tables, citations, actionable next steps
└─────────────────────────────────────┘
```

### 2. Hybrid Retrieval (`src/retrieval.py` + `src/advanced_retrieval.py`)

| Stage | Component | Config | Output |
|-------|-----------|--------|--------|
| Dense | FAISS (IVF-Flat) | `BAAI/bge-base-en-v1.5`, 768d | Top-50 vectors |
| Sparse | BM25 (Okapi) | `rank_bm25` | Top-50 keywords |
| Fusion | RRF | `k=60` | Fused ranking |
| Re-rank | Cross-Encoder | `BAAI/bge-reranker-base` | Top-10 reranked |
| CRAG Gate | Threshold | `score ≥ 0.50` | Pass → Agents / Fail → DDGS web search |

### 3. Fine-Tuned Embeddings (`src/finetune_embeddings.py`)

- **Base:** `BAAI/bge-base-en-v1.5` (768d)
- **Loss:** `MultipleNegativesRankingLoss` + Hard Negatives
- **Data:** 150 domain triples (query, positive, hard negative)
- **Hardware:** Mac MPS GPU, 3 epochs, batch=16
- **Result:** MRR@10 **75.6% → 97.5%** (+21.92%)
- **Output:** `models/bge_base_german_visa/` (local, push to HF Hub optional)

---

## 🧪 Testing & Quality Gates (Exact Commands)

### CI Gate (Runs on Every Push/PR — Must Pass)

```bash
# This is what GitHub Actions runs (see .github/workflows/rag_eval_ci.yml)
python -m tests.eval_ragas
```

**Thresholds (hard gates — build fails if any metric below):**

| Metric | Threshold | Current (README) |
|--------|-----------|------------------|
| Faithfulness (Groundedness) | ≥ 3.50 / 5.0 | 4.35 ✅ |
| Answer Relevance | ≥ 4.00 / 5.0 | 4.20 ✅ |
| Context Precision | ≥ 75.0% | 85.0% ✅ |

### Local Experimentation (TruLens Dashboard)

```bash
python -m tests.eval_trulens    # Compares chunk_size=400 vs 600, launches Streamlit dashboard
```

### Unit / Integration Tests

```bash
# All tests (run from repo root)
python -m pytest tests/ -v

# Focused runs
python -m pytest tests/test_rag_quality.py -v        # Retrieval quality
python -m pytest tests/test_rag_triad.py -v          # RAG triad (ret→gen→eval)
python -m pytest tests/test_embeddings.py -v         # Embedding sanity
python -m pytest tests/test_document_sync.py -v      # Incremental sync
python -m pytest tests/test_tracing.py -v            # Langfuse/Weave integration
```

---

## 📦 Dependency Management

| File | Purpose | When to Use |
|------|---------|-------------|
| `requirements.txt` | **Minimal deps (23 lines)** — use for CI, Docker, production | `pip install -r requirements.txt` |
| `requirement.txt` | **Pinned freeze (130 lines)** — `pip freeze > requirement.txt` | Reproducing exact local env |

**Key Dependencies (from `requirements.txt`):**

```text
streamlit>=1.30.0
groq>=0.4.0
sentence-transformers>=2.2.2
faiss-cpu>=1.7.4
rank_bm25>=0.2.2
pydantic>=2.0.0
python-dotenv>=1.0.0
huggingface_hub>=0.20.0
numpy>=1.24.0
trafilatura>=1.6.0
pdfplumber>=0.10.0
ddgs>=0.1.0
fastapi>=0.111.0
uvicorn>=0.30.0
psycopg2-binary>=2.9.9
pgvector>=0.2.5
sqlalchemy>=2.0.30
asyncpg
pybreaker
langfuse>=2.0.0
openai>=1.0.0
weave>=0.5.0
wandb>=0.16.0
```

> **Never edit `requirement.txt` manually.** Regenerate via `pip freeze > requirement.txt` after `pip install -r requirements.txt`.

---

## 🐳 Docker & Infrastructure

### `docker-compose.yml` (Postgres + pgvector only)

```yaml
services:
  postgres:
    image: ankane/pgvector:v0.5.1
    environment:
      POSTGRES_USER: behoerden_user
      POSTGRES_PASSWORD: behoerden_password
      POSTGRES_DB: behoerden_bot
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
```

**Start:** `docker-compose up -d postgres`  
**Stop:** `docker-compose down`  
**Reset DB:** `docker-compose down -v && docker-compose up -d postgres`

### Database Schema (Postgres + pgvector)

- `documents` — source metadata (title, url, hash, chunk_count)
- `chunks` — text + embedding (vector(768)), FK to documents
- `conversations` — session_id, user_id, created_at
- `messages` — conversation_id, role, content, metadata (tokens, latency)

Run migration: `python src/migrate_to_postgres.py` (idempotent, uses `DATABASE_URL`)

---

## 🔧 Common Tasks (Agent Cheatsheet)

### Add New Source Documents

```bash
# 1. Drop PDFs into data/raw/ (or update data/sources.json with URLs)
# 2. Re-ingest (incremental — only new/changed files)
python src/ingest.py
# 3. Re-embed
python src/embed.py
# 4. (Optional) Re-run benchmark
python src/run_comparative_benchmark.py
```

### Switch Embedding Model (e.g., after fine-tuning)

```python
# In src/embed.py and src/retrieval.py:
# Change model_name from "BAAI/bge-base-en-v1.5" to "models/bge_base_german_visa"
# Or set EMBEDDING_MODEL_PATH env var (read in utils.py:get_embedding_model())
```

### Adjust Retrieval Hyperparameters

| File | Parameter | Default | Tuning Notes |
|------|-----------|---------|--------------|
| `src/retrieval.py` | `TOP_K_DENSE` | 50 | ↑ recall, ↓ latency |
| `src/retrieval.py` | `TOP_K_SPARSE` | 50 | ↑ keyword match |
| `src/retrieval.py` | `RRF_K` | 60 | RRF fusion constant |
| `src/advanced_retrieval.py` | `RERANK_TOP_K` | 10 | Cross-encoder rerank depth |
| `src/advanced_retrieval.py` | `CRAG_THRESHOLD` | 0.50 | ↓ = more web fallback, ↑ = stricter |

### Change LLM Provider / Model

Edit `src/llm_client.py`:

```python
# Primary (Groq) — 14.4k req/day free, 800 tok/s
PRIMARY_PROVIDER = "groq"
PRIMARY_MODEL = "llama-3.1-8b-instant"

# Fallback (Hugging Face Inference API)
FALLBACK_PROVIDER = "huggingface"
FALLBACK_MODEL = "meta-llama/Meta-Llama-3.1-8B-Instruct"

# Retry/backoff config
MAX_RETRIES = 3
BASE_DELAY = 1.0  # seconds
```

### Run Fine-Tuning Again (New Data)

```bash
# 1. Prepare new triples in data/fine_tune_triples.jsonl (query, pos, hard_neg)
# 2. Run fine-tuning (3 epochs, MPS GPU)
python src/finetune_embeddings.py \
  --input data/fine_tune_triples.jsonl \
  --output models/bge_base_german_visa_v2 \
  --epochs 3 \
  --batch-size 16
# 3. Evaluate MRR@10
python src/run_comparative_benchmark.py
```

---

## 🐛 Debugging & Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| `ModuleNotFoundError: sentence_transformers` | Venv not activated / deps not installed | `source .venv/bin/activate && pip install -r requirements.txt` |
| `CUDA out of memory` / `MPS backend not available` | Fine-tuning on CPU fallback | Ensure `torch.backends.mps.is_available()` — Mac only |
| `GROQ_API_KEY not set` | Missing env var | `export GROQ_API_KEY=...` or add to `.env` |
| `FAISS index not found` | `embed.py` not run | `python src/embed.py` |
| `pgvector extension not found` | Postgres not started / wrong image | `docker-compose up -d postgres` (uses `ankane/pgvector`) |
| RAGAS eval fails: `Faithfulness < 3.5` | Retrieval quality dropped | Check `CRAG_THRESHOLD`, re-run `embed.py`, verify chunks |
| Streamlit won't start: `Address already in use` | Port 8501 busy | `streamlit run app.py --server.port 8502` |
| `ddgs` web search fails | Network / rate limit | Increase `DDGS_BACKOFF` in `llm_client.py` or disable web fallback |

---

## 📊 Evaluation Reports (Evidence Locations)

| Report | Location | Contents |
|--------|----------|----------|
| Fine-tuning MRR@10 | `docs/finetune_report.md` | Epoch curves, MRR@10 75.6% → 97.5% |
| RAGAS CI Results | `tests/eval_ragas.py` output | Faithfulness, Relevance, Context Precision per run |
| Comparative Benchmark | `src/run_comparative_benchmark.py` output | Table 3: Baseline vs CRAG (Context P/R, Faithfulness, Relevance) |
| TruLens Dashboard | `python -m tests.eval_trulens` | Interactive chunk-size comparison (400 vs 600) |

---

## 🚨 Critical Gotchas (Things Agents Miss)

1. **Two requirements files** — `requirements.txt` (23 lines) is for CI/production; `requirement.txt` (130 lines) is a local freeze. **Install from `requirements.txt`.**

2. **Postgres required for CRAG** — The hybrid retrieval + pgvector storage needs `docker-compose up -d postgres` running. SQLite fallback only works for baseline RAG.

3. **Fine-tuning needs MPS GPU** — On Mac M-series, `torch.backends.mps.is_available()` must be `True`. On Linux/CI, fine-tuning runs on CPU (slow) or requires CUDA.

4. **Groq rate limit = 14,400 req/day** — `llm_client.py` has 3-retry exponential backoff. If you hit quota, it falls back to HF (slower). Monitor via Langfuse.

5. **CRAG threshold is 0.50** — Below this, the system triggers DDGS live web search. If you see many web fallbacks, raise threshold or improve embeddings.

6. **Streamlit config** — `.streamlit/config.toml` sets `server.port=8501`, `server.enableCORS=false`, `server.enableXsrfProtection=false`. Don't change unless deploying.

7. **PII masking runs before LLM call** — `pii_masker.py` redacts names, emails, phones, passport numbers. Check `src/agentic_rag.py:ResearchAgent._mask_pii()`.

8. **Semantic cache key = query embedding** — `semantic_cache.py` uses cosine similarity ≥ 0.95. Clear with `python -c "from src.semantic_cache import SemanticCache; SemanticCache().clear()"`.

9. **No hardcoded paths** — All paths resolved via `utils.get_project_root()` / `utils.get_data_dir()`. Works from any CWD.

10. **CI runs `tests/eval_ragas.py` ONLY** — Other tests (`eval_trulens`, `test_rag_quality`, etc.) are local-only. PR will fail if RAGAS thresholds not met.

---

## 📝 Conventions for Agents Working Here

- **Python 3.11+**, type hints mandatory (`pydantic` for configs, `typing` for funcs)
- **No `print()` in library code** — use `logging` (configured in `utils.py:setup_logging()`)
- **Async for I/O** — `llm_client.py`, `database.py`, `retrieval.py` use `async/await`
- **Pydantic Settings** — All config via `utils.Settings` (loads `.env` automatically)
- **Tests = documentation** — Read `tests/test_rag_triad.py` to understand the retrieval→generation→eval flow
- **Never commit secrets** — `.env` is gitignored; `.env.example` is the template
- **Run `python -m tests.eval_ragas` before pushing** — CI will fail otherwise

---

> This AGENTS.md covers **only Repo-2 (Behoerden Bot)**. For Pirtfolio or ARV-Shop-Manager, see their respective `AGENTS.md` / `CLAUDE.md` / `README.md`.

---

## 📌 Version / Maintenance Notes

- **Last verified:** 2026-07-30 (all commands tested in sandbox)
- **Python:** 3.11+ (3.12/3.13 untested)
- **Streamlit:** 1.41.0 (pinned in README frontmatter for HF Spaces)
- **Key model versions:** BGE-base-en-v1.5, bge-reranker-base, llama-3.1-8b-instant
- **Fine-tuned model:** `models/bge_base_german_visa/` (local) — push to HF Hub if sharing

---

**End of AGENTS.md** — This file is the single source of truth for agent operations in Repo-2. Update it when architecture, commands, or thresholds change.