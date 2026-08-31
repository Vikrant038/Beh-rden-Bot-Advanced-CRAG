# Behoerden Bot (Repo-2) — AGENTS.md

> **Project:** Enterprise Corrective RAG (CRAG) for German immigration, student visa, APS, and university applications — English + German.
> **Production app (this repo's hero):** Next.js 15 (App Router) · React 19 · TypeScript 5 · tRPC 11 · Prisma + pgvector · Auth.js v5 · Groq LLM · BGE-M3 embeddings (Cloudflare worker) · Tailwind v4 · Vitest + Playwright.
> **Reference implementation:** `mvp-python/` — the original Python/Streamlit research code the TS pipeline was ported from (FastAPI + Streamlit + FAISS/BM25 + 3-Agent ReAct).
> **The two sides share a design lineage but ZERO runtime code.** The web app never calls Python.

---

## 🏗️ Repository Structure (Verified)

```
Repo-2/
├── web-app/                        # ★ PRODUCTION APP (TypeScript — the shipped product)
│   ├── src/app/                    #   Pages, layouts, API routes (App Router)
│   ├── src/components/             #   Chat UI, landing, admin dashboard, pipeline visualizer
│   ├── src/server/
│   │   ├── rag/                    #   TS RAG pipeline: guardrail → hybrid retrieval → CRAG
│   │   │   ├── pipeline.ts         #     Standard CRAG path (runStandardCrag)
│   │   │   ├── orchestrator.ts     #     Agentic path (research/analyst/writer)
│   │   │   ├── guardrail.ts        #     Domain + safety guardrail (fail-closed)
│   │   │   ├── retrieval/          #     hybrid.ts · sparse.ts · reranker.ts · corpus.ts
│   │   │   └── agents/             #     Research / Analyst / Writer agents
│   │   ├── routers/                #   tRPC endpoints (conversation, admin, public)
│   │   ├── db/                     #   Centralized data layer (mapping, analytics, policy)
│   │   ├── ingest/                 #   PDF/URL ingest → chunk → embed → store
│   │   ├── embeddings/             #   BGE-M3 client (HF/Cloudflare/Gemini) + batch cache
│   │   ├── pii/                    #   PII masking (GDPR)
│   │   └── llm/                    #   Provider abstraction + circuit breaker + usage/cost
│   ├── prisma/                     #   Schema + migrations (pgvector HNSW + FTS GIN indexes)
│   ├── scripts/                    #   eval-crag-webapp, seed-corpus, ingest helpers
│   ├── data/                       #   Corpus PDFs/URLs, eval testset (committed)
│   ├── docs/                       #   Phase docs, status, security, EVALUATION.md
│   └── tests/                      #   Vitest (unit + integration) + Playwright E2E
│
├── mvp-python/                     # ★ RESEARCH & EVAL REFERENCE (Python — not shipped)
│   ├── app.py / api.py             #   Streamlit UI / FastAPI+SSE backend
│   ├── src/                        #   rag.py · agentic_rag.py · advanced_retrieval.py
│   │                               #   finetune_embeddings.py · retrieval/embed/ingest
│   ├── tests/                      #   pytest suite + eval_ragas.py (quality eval)
│   ├── scripts/                    #   embed-server (BGE-M3), launch helpers
│   ├── models/                     #   Fine-tuned BGE embedding model (gitignored)
│   ├── data/                       #   Python-side corpus artifacts (gitignored)
│   ├── docker-compose.yml          #   MVP Postgres (ankane/pgvector) — port 5432
│   └── docs/                       #   Fine-tuning guide, 30-phase plan, feasibility
│
├── docs/                           # Project-level design + engineering docs (see README map)
├── .github/workflows/              # ci · e2e · security · eval (web-app gates)
├── .venv/                          # Python venv for the MVP (gitignored, stays at root)
└── README.md                       # Web-app-first project README (architecture + numbers)
```

> **All paths in the MVP sections below are relative to `mvp-python/`.**

---

## ⚡ Quickstart — Web app (the product)

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

Local embedding/rerank during development (speak the exact production contracts):

```bash
.venv/bin/python mvp-python/scripts/embed-server.py  # BGE-M3 on :8765
```

### Quality gates (all enforced in CI)

```bash
cd web-app
pnpm lint                # ESLint
pnpm typecheck           # tsc --noEmit
pnpm test                # Vitest (unit + integration)
pnpm vitest run --coverage   # 85% coverage floor
pnpm test:e2e            # Playwright (desktop + mobile viewports)
pnpm build               # production build (turbopack + CSP nonce path)
```

### Workflows (`.github/workflows/`)

| Workflow | Triggers | What it runs |
|----------|----------|--------------|
| `ci-web-app.yml` | push/PR on `web-app/**` | format:check, lint, typecheck, tests, 85% coverage gate, build |
| `e2e-web-app.yml` | push/PR on `web-app/**` | Playwright (chromium + mobile-chromium), pgvector service container |
| `security-web-app.yml` | push/PR + weekly | Gitleaks, Semgrep, CodeQL (TS), Anchore SBOM |
| `eval-web-app.yml` | weekly + manual | 30-question multilingual CRAG eval vs. the real TS pipeline (see `web-app/docs/EVALUATION.md`) |

> `deploy-web-app.yml` and the old Python `rag_eval_ci.yml` were removed. Python changes are **not** CI-gated — the MVP is a reference; the product is the web app.

---

## 🔐 Environment Variables

**Web app** (`web-app/.env`): `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `NEXTAUTH_SECRET`/`AUTH_SECRET`, `GROQ_API_KEY`, `GROQ_MODEL`, `HF_TOKEN`, `HF_INFERENCE_URL`, `EMBEDDING_MODEL`, `RERANKER_URL`/`RERANKER_TOKEN`/`RERANKER_MODEL`, `SCROLL_ASSETS_URL`, `GITHUB_CLIENT_ID/SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `RESEND_API_KEY`, `LANGFUSE_*`, `UPSTASH_REDIS_*`.

**MVP** (`mvp-python/.env`): `GROQ_API_KEY`, `HF_TOKEN`, `POSTGRES_*`, `LANGFUSE_*`, `WANDB_*`, `CORS_ALLOWED_ORIGINS`.

> **Never commit `.env`.** Copy the matching `.env.example` and fill secrets locally.

---

## 🧠 The Production Pipeline (web-app, TypeScript)

```
User question
    │
    ▼
[Stage 0]   PII masking (GDPR) + disambiguation
[Stage 0A]  Domain + safety guardrail          — deterministic term cache + LLM classifier, fail-closed
[Cache]     Semantic cache (hash + pgvector cos ≥0.97, 7-day TTL)
[Stage 1]   Bilingual sub-query expansion (EN + DE)
[Stage 2]   Hybrid retrieval — dense (pgvector HNSW, BGE-M3 1024-d) + sparse (Postgres FTS / BM25)
[Stage 3]   RRF fusion → cross-encoder re-rank (bge-reranker) to top-5
[Stage 4]   CRAG gate — confident → grounded answer; low confidence → honest fallback / web search
[Stage 5]   Grounded generation (Groq) + cited sources + cache write + telemetry
```

Every stage emits typed telemetry (durations, tokens, per-agent costs, retrieval path, cache decision) — surfaced in the **admin pipeline tester** (`/admin/pipeline-tester`, Agentic ⇄ Standard CRAG switch) and Langfuse.

Key files: `src/server/rag/pipeline.ts` (standard CRAG), `src/server/rag/orchestrator.ts` (agentic), `src/server/rag/guardrail.ts`, `src/server/rag/retrieval/hybrid.ts`, `src/server/rag/query-expansion.ts`.

---

## 🧪 The Evaluation Harness (product artifact)

- `web-app/scripts/eval-crag-webapp.ts` runs the **same 30 multilingual questions** (2 adversarial traps) through the real TS pipeline: faithfulness ≥3.5, relevance ≥4.0, precision ≥0.75, recall ≥0.70, traps 2/2.
- Resumable checkpoint + retry/backoff; full runbook in `web-app/docs/EVALUATION.md`; CI gate = `eval-web-app.yml`.
- Current scorecard (production TS): all six gates pass — Faithfulness 3.98, Relevance 4.83, BGE-M3 0.70, Precision 100%, Recall 72.1%, Traps 2/2.

---

# MVP Reference (Python — `mvp-python/`)

Research/reference implementation; paths below are relative to `mvp-python/`.

## MVP Quickstart

```bash
cd mvp-python
../.venv/bin/python -m pytest tests/ -x -q     # unit tests (venv lives at repo root)
../.venv/bin/python -m tests.eval_ragas       # LLM-judged quality eval
../.venv/bin/python src/run_comparative_benchmark.py   # Baseline vs CRAG benchmark
../.venv/bin/python src/finetune_embeddings.py         # MNRL + hard-negative fine-tuning

# Streamlit UI (port 8501)
streamlit run app.py --server.port 8501
```

Postgres: `docker compose up -d postgres` (this folder's compose; do NOT run together with `web-app/docker-compose.yml` — both use port 5432).

## MVP Architecture

### 3-Agent ReAct Pipeline (`src/agentic_rag.py`)

```
User Query → Stage 0 disambiguation → Hybrid retrieval (FAISS dense + BM25 sparse)
          → RRF fusion → cross-encoder re-rank → CRAG gate (≥0.50)
          → Agent 1 Research → Agent 2 Analyst → Agent 3 Writer (markdown + citations)
```

| Stage | Component | Config |
|-------|-----------|--------|
| Dense | FAISS (IVF-Flat) | `BAAI/bge-base-en-v1.5`, 768d |
| Sparse | BM25 (Okapi) | `rank_bm25` |
| Fusion | RRF | `k=60` |
| Re-rank | Cross-Encoder | `BAAI/bge-reranker-base` |
| CRAG Gate | Threshold | `score ≥ 0.50` → Pass → Agents / Fail → DDGS web search |

### Fine-Tuned Embeddings (`src/finetune_embeddings.py`)

- Base `BAAI/bge-base-en-v1.5` (768d) → MNRL + hard negatives, 150 domain triples, 3 epochs on Apple MPS → **MRR@10 75.6% → 97.5%** (+21.92%).
- The production web app instead uses **BGE-M3 (1024-d, multilingual)** — see `web-app/docs/status/phase-i-embedding-architecture.md` for the migration.

### Hyperparameter reference

| File | Parameter | Default | Notes |
|------|-----------|---------|-------|
| `src/retrieval.py` | `TOP_K_DENSE` / `TOP_K_SPARSE` | 50 / 50 | ↑ recall, ↓ latency |
| `src/retrieval.py` | `RRF_K` | 60 | RRF fusion constant |
| `src/advanced_retrieval.py` | `RERANK_TOP_K` | 10 | Cross-encoder rerank depth |
| `src/advanced_retrieval.py` | `CRAG_THRESHOLD` | 0.50 | ↓ = more web fallback |

### MVP gotchas (things agents miss)

1. **Two requirements files** — `requirements.txt` (minimal, CI/production) vs `requirement.txt` (local `pip freeze`). Install from `requirements.txt`.
2. **Postgres required for CRAG** — `docker compose up -d postgres` (this folder) must be running; SQLite fallback only for baseline RAG.
3. **Fine-tuning needs MPS GPU** — on Mac M-series `torch.backends.mps.is_available()` must be `True`; CPU fine-tuning is slow.
4. **Groq rate limit = 14,400 req/day** — `src/llm_client.py` has 3-retry exponential backoff + HF fallback.
5. **PII masking runs before any LLM call** — `src/pii_masker.py`; wired into the agent loop.
6. **No hardcoded paths** — all paths resolve via `src/utils.get_project_root()` (the `mvp-python/` root), so commands work from any CWD inside the MVP.
7. **Semantic cache key = query embedding** — cosine ≥0.95; clear via `python -c "from src.semantic_cache import SemanticCache; SemanticCache().clear()"`.

---

## 📌 Version / Maintenance Notes

- **Last verified:** 2026-08-10 (repo restructured web-app-first; MVP moved to `mvp-python/`).
- **Web app:** Next.js 15.5 · React 19 · TS 5 · pnpm 11.20.0 · Node 22 · Prisma 6 · pgvector (BGE-M3 1024-d).
- **MVP:** Python 3.14 venv at repo root (`.venv/`), Streamlit 1.41.0, `BAAI/bge-base-en-v1.5` fine-tuned 768-d.
- **Key models:** Groq `openai/gpt-oss-120b` (primary) · `BAAI/bge-m3` embeddings · `BAAI/bge-reranker-v2-m3` reranker. Hugging Face remains the LLM fallback.

---

**End of AGENTS.md** — the agent-operations guide. Keep it in sync when architecture, commands, workflows, or thresholds change.
