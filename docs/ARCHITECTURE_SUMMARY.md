# Architecture Summary — Behoerden Bot (Full Project)

> **Complete overview of both the Python RAG backend and Next.js web app**

---

## 🏗️ System Components

### **Component 1: Python Backend (Repo-2 root)**

**Purpose:** 3-Agent ReAct RAG orchestrator with domain-fine-tuned embeddings

**Stack:**
- Python 3.11, FastAPI, Streamlit UI
- LLM: Groq API (llama-3.1-8b)
- Embeddings: BGE (fine-tuned on domain triples, +21.92% MRR)
- Retrieval: FAISS (dense) + BM25 (sparse)
- Database: PostgreSQL + pgvector
- Observability: Langfuse + Weights & Biases

**Architecture:**
```
Query
  ↓
Stage 0A: Domain + Safety Guardrail
  ├─ Negative terms cache (instant reject: crypto, sports, etc)
  └─ LLM classifier (instruction-following fallback)
  ↓
Stage 0B: Query Disambiguation
  ├─ Catches vague queries
  └─ Surfaces 3 clarifying options
  ↓
Semantic Cache Check
  ├─ Query hash match (exact) OR
  └─ pgvector cosine similarity ≥0.93
  ↓
Stage 1: Multi-Query Expansion
  └─ LLM generates 3 sub-queries
  ↓
Stage 2: Hybrid Retrieval
  ├─ Dense: FAISS (BGE-m3 1024-d, k=15)
  ├─ Sparse: BM25 (Okapi, k=15)
  └─ Fusion: Reciprocal Rank Fusion (k=60)
  ↓
Stage 3: Cross-Encoder Re-ranking
  └─ BAAI/bge-reranker-base (top-k=5)
  ↓
Stage 4: CRAG Gate
  ├─ Score ≥0.50? → Pass to agents
  └─ Score <0.50? → Live web search fallback (DDGS)
  ↓
Stage 5: 3-Agent ReAct Orchestrator
  ├─ Agent 1: Research Agent (tool-calling loop)
  │  └─ Tools: faiss_search, web_search, visa_calculator
  ├─ Agent 2: Analyst Agent (5-D comparative matrix)
  │  └─ Dimensions: Requirements, Timeline, Cost, Risk, Alternatives
  └─ Agent 3: Writer Agent (markdown synthesis)
     └─ Output: formatted response + citations + next steps
  ↓
Response + Sources + Metadata
  ↓
Persist to PostgreSQL Semantic Cache + Conversational Memory
```

**Key Files:**
- `src/agentic_rag.py` — Main 3-agent orchestrator
- `src/rag.py` — Baseline single-agent (for comparison)
- `src/retrieval.py` + `src/advanced_retrieval.py` — Hybrid retrieval
- `src/semantic_cache.py` — pgvector caching
- `src/memory.py` — Conversation memory (LangChain)
- `src/ingest.py` → `src/embed.py` → FAISS index
- `mvp-python/tests/eval_ragas.py` — RAGAS-style reference eval (Faithfulness ≥3.5, Relevance ≥4.0)

---

### **Component 2: Next.js Web App (web-app folder)**

**Purpose:** Production-grade chat UI, auth, admin dashboard

**Stack:**
- Next.js 15 (App Router), React 19, TypeScript 5
- UI: Tailwind CSS 4, shadcn/ui
- API: tRPC 11 (type-safe RPC), Prisma 6
- Auth: NextAuth v5 (OAuth + magic links)
- Database: PostgreSQL + pgvector
- Deployment: Vercel

**Architecture:**
```
FRONTEND (React Components)
  ├─ Chat UI (message input, bubbles, sources)
  ├─ Conversation history
  ├─ Admin dashboard (metrics, document ingest)
  └─ Auth UI (login, signup)
        ↓ tRPC (type-safe)
API ROUTES (Next.js)
  ├─ POST /api/chat/stream (SSE streaming)
  ├─ tRPC /api/trpc/[trpc]
  ├─ POST /api/cron/cleanup-cache (7-day TTL)
  ├─ POST /api/cron/process-ingest-jobs
  └─ OAuth /api/auth/[...nextauth]
        ↓
BUSINESS LOGIC (tRPC Routers)
  ├─ rag/chat-pipeline.ts (stages 0-5)
  ├─ routers/conversation.ts (CRUD)
  ├─ routers/admin.ts (metrics)
  └─ routers/document.ts (ingest)
        ↓
DATA LAYER (Prisma ORM + Raw SQL)
  ├─ Prisma: conversation, message, user, feedback
  └─ Raw pgvector SQL: semantic cache, chunk search
        ↓
POSTGRESQL (16 + pgvector extension)
  ├─ users, accounts, sessions (NextAuth)
  ├─ conversations, messages, message_feedback
  ├─ documents, document_chunks, document_parents
  ├─ semantic_cache (7-day TTL)
  ├─ conversation_memories
  ├─ ingest_jobs (background queue)
  └─ pipeline_runs (admin testing)
```

**Key Folders:**
- `src/app/` — Pages + API routes (Next.js App Router)
- `src/server/rag/` — RAG pipeline (stages 0A-5)
- `src/server/routers/` — tRPC endpoints
- `src/server/db/` — Database utilities
- `src/server/llm/` — LLM provider abstraction
- `src/components/` — React components
- `src/hooks/` — Client-side hooks
- `prisma/` — Schema + migrations

**Stage 1 is English-first** (`src/server/rag/query-expansion.ts`): the
corpus is stored entirely in English (ingest normalizes every document:
detect → translate → chunk → embed), so one LLM call detects the user's
query language, translates it to English, and returns
`{ language, queries }` — always-English queries where `queries[0]` is the
canonical translation **and the canonical cache key**: answers are
dual-written under the raw query and `queries[0]`, so a German ask and its
English equivalent share one cached answer. Each cache entry stores the
language it was written in; a hit whose language differs from the current
user's query language is flagged as `languageMismatch` in `ChatMetadata`.
The detected `language` also flows into the writer's system prompt
("Answer in {language}") so answers come back in the user's language, and
into `ChatMetadata`/traces.

---

## 🔄 How They Connect

```
┌──────────────────────────────────────────────────┐
│          NEXT.JS WEB APP                         │
│  (user-facing chat + admin dashboard)            │
│  ├─ Frontend: React components                   │
│  ├─ API routes: streaming, tRPC                  │
│  ├─ Auth: NextAuth (JWT sessions)                │
│  └─ Database: Prisma ORM + pgvector              │
└───────────────────┬────────────────────────────┘
                    │ SSE streaming
                    │ tRPC calls
                    │ Langfuse traces
                    │
    ┌───────────────▼───────────────┐
    │  RAG PIPELINE                  │
    │  (running INSIDE Next.js       │
    │   API routes, NOT Python)      │
    │                                │
    │  ├─ Stage 0A: Guardrail        │
    │  ├─ Stage 1: Query expansion   │
    │  ├─ Stage 2: Hybrid retrieval  │
    │  ├─ Stage 3: Reranking         │
    │  ├─ Stage 4: CRAG gate         │
    │  └─ Stage 5: 3-Agent ReAct    │
    │                                │
    │  Uses:                         │
    │  ├─ Groq API (LLM)            │
    │  ├─ HF Inference (embeddings) │
    │  ├─ FAISS (dense search)      │
    │  ├─ BM25 (sparse search)      │
    │  └─ pgvector (caching)        │
    └────────────────────────────┬──┘
                                 │
                 ┌───────────────▼──────────────┐
                 │  PYTHON BACKEND (OPTIONAL)   │
                 │                              │
                 │  Runs locally in dev only:   │
                 │  ├─ Streamlit UI (8501)      │
                 │  ├─ Document ingest          │
                 │  ├─ Fine-tune embeddings     │
                 │  ├─ Benchmark comparisons    │
                 │  └─ CI evals (RAGAS)         │
                 │                              │
                 │  NOT called by web app       │
                 │  (RAG is ported to TS)       │
                 └──────────────────────────────┘
```

**Key Point:** The Python code is a **development reference**. The production web app **reimplements** the RAG pipeline in TypeScript (same logic, different language) so it runs on Vercel without Python dependencies.

---

## 📊 Architectural Pattern

### **This Is NOT MVC**

| Aspect | Why Not MVC |
|--------|------------|
| **Model** | Two systems: RAG + Web layer. No single model answering all queries |
| **View** | React components consume tRPC RPC results, not models directly |
| **Controller** | tRPC routers are controllers, but RAG pipeline orchestrates separately |

### **Actual Pattern: Domain-Driven + Pipeline Architecture**

1. **Domain Layer** (`src/server/rag/`)
   - Pure business logic: retrieval, ranking, agent orchestration
   - No HTTP coupling; just functions
   - Testable in isolation

2. **API Layer** (`src/app/api/`, `src/server/routers/`)
   - tRPC routers expose domain logic via RPC
   - Type safety from source to client
   - Automatic validation

3. **Presentation Layer** (`src/components/`)
   - React components consume tRPC
   - Zero business logic (delegation only)

4. **Data Layer** (`src/server/db/`, `prisma/`)
   - Prisma ORM + raw pgvector SQL
   - Single source of truth for schema

---

## 🎯 Architecture Quality Score

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Separation of Concerns** | 9/10 | Each layer has clear responsibility |
| **Type Safety** | 10/10 | TypeScript end-to-end + Zod validation |
| **Database Design** | 9/10 | Normalized, indexed, role-based access. JSON blob (sources) could be normalized (PHASE 3) |
| **Error Handling** | 8/10 | Typed errors, mapped to status codes. Could add error tracking (Sentry) |
| **Async/Await** | 9/10 | Proper Promise handling. Ingest sync timeout risk (PHASE 2) |
| **Testing** | 8/10 | 249 test files. Could increase E2E coverage |
| **Documentation** | 6/10 | Now 9/10 with ARCHITECTURE.md + this guide! |
| **Observability** | 8/10 | Langfuse + Pino. Could add APM (DataDog) |
| **Security** | 9/10 | Parameterized SQL, PII masking, PoLP. Guardrail injection (documented, PHASE 2) |
| **Performance** | 7/10 | Caching works. Could optimize: HNSW index, connection pooling |

**Overall: 8.3/10 — Production-Ready with Optimization Roadmap**

---

## 🚀 Optimization Priorities (By Impact)

### **Phase 1 (IMMEDIATE)** — Security & Stability

- ✅ Configure Upstash Redis (rate limiter needs persistence)
- ✅ Set up Langfuse (production observability)
- ✅ Verify pre-commit hooks (no secrets leaking)

### **Phase 2 (Q3 2026)** — Performance & Robustness

- Replace LLM guardrail with BERT classifier (eliminate prompt injection surface)
- Migrate ingest pipeline to background queue (Vercel Cron + DB table)
- Add HNSW index on pgvector embeddings (faster search)
- Implement connection pooling (Neon pooler)

### **Phase 3 (Q4 2026)** — Schema Refinement

- Normalize `Message.sources` to `MessageSource` relation (enable SQL analytics)
- Add citation frequency analytics (admin dashboard)
- Implement document-level access control (multi-tenant)

### **Phase 4 (Q1 2027)** — Scale & Monitoring

- Add APM (DataDog / Datadog)
- Implement cache warming (pre-embed popular queries)
- Add automated testing of retrieval quality (continuous RAGAS evals)

---

## 📁 Which System for What

### **Use Python Backend When:**
- Running RAGAS evaluations (CI gate)
- Fine-tuning embeddings locally
- Benchmarking RAG strategies
- Processing large batches of documents

### **Use Next.js Web App When:**
- End users chat with the system
- Admin ingests new documents
- Running production inference
- Deploying to cloud (Vercel)

---

## 🔗 Documentation Map

```
README.md (quick start — flagship doc)
  ├─ FIRST_PRINCIPLES.md (why every decision was made)
  ├─ ENGINEERING_JOURNEY.md (phases, failures, deployment war stories)
  ├─ TESTING_AND_QUALITY.md (the four-layer quality system + RAG evals)
  │
  └─ web-app/
      ├─ README.md (web-app quickstart + DB role model)
      ├─ ARCHITECTURE.md (folder structure, data flow, design patterns)
      ├─ DEVELOPER_QUICKSTART.md (common tasks, copy-paste ready)
      ├─ OPTIMIZATION_GUIDE.md (database, async, performance targets)
      ├─ docs/STARTUP.md (local setup)
      ├─ docs/security/SECURITY_EXCEPTIONS.md (known limitations)
      ├─ docs/ROADMAP.md (future features)
      └─ prisma/schema.prisma (database schema — source of truth)

  Python reference (repo root)
      ├─ AGENTS.md (agent architecture)
      └─ docs/ (detailed eval reports)
```

---

## ✅ For New Team Members

**Start here:**
1. Read this document (5 min)
2. Read `ARCHITECTURE.md` (30 min)
3. Read `DEVELOPER_QUICKSTART.md` (10 min)
4. Run `pnpm dev` and make a chat (5 min)
5. Add a simple feature (console.log in a route) (15 min)

**Total onboarding: ~1 hour**

---

**Last Updated:** 2026-08-11  
**Status:** Complete ✅  
**Ready for:** New hires, code reviews, architecture decisions
