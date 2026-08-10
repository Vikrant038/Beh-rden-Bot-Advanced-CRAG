# Architecture Guide — Behoerden Bot Web App

> **Purpose:** This document explains the complete system architecture, folder structure, design patterns, and optimization roadmap for developers who need to understand, modify, or extend the codebase.

---

## 📊 Architecture Overview

### **Pattern Classification**

Your project follows a **hybrid server-driven architecture** combining:

1. **Backend: Layered Architecture** (Python)
   - Clear separation: Data → Processing → API → Presentation
   - RAG pipeline (Retrieval Augmented Generation) with orchestration

2. **Frontend: Next.js App Router (TypeScript)**
   - Server Components + API Routes + Client State
   - tRPC for type-safe RPC calls (replaces traditional REST)

3. **Database: Domain-Driven Data Model**
   - PostgreSQL with vector extensions (pgvector)
   - Semantic caching + conversation memory
   - Principle of Least Privilege (DDL/DML role separation)

### **NOT Traditional MVC**

This is **NOT MVC (Model-View-Controller)** because:
- MVC has a **single model** answering all queries
- You have **two separate systems**: RAG pipeline + Web UI
- The RAG system produces domain logic; the web layer consumes it

### **Actual Pattern: Domain-Driven + Pipeline Architecture**

```
┌─────────────────────────────────────────────────────┐
│         CLIENT LAYER (React 19 + TypeScript)       │
│  - Chat UI, conversation history, admin dashboard  │
└────────────────────┬────────────────────────────────┘
                     │ tRPC (type-safe RPC)
┌────────────────────▼────────────────────────────────┐
│     API LAYER (Next.js Route Handlers)              │
│  - /api/chat/stream (SSE streaming)                 │
│  - /api/trpc/* (tRPC procedures)                    │
│  - /api/cron/* (scheduled jobs)                     │
│  - /api/auth/* (NextAuth OAuth)                     │
└────────────────────┬────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
┌───────▼──────┐         ┌───────▼──────┐
│ DATABASE     │         │ RAG PIPELINE │
│ LAYER        │         │ (Orchestration)
│ (Prisma ORM) │         │
│              │         ├─ Stage 0A: Guardrail
│ PostgreSQL   │         ├─ Stage 0B: Disambiguation
│ + pgvector   │         ├─ Stage 1: Query Expansion
│              │         ├─ Stage 2: Hybrid Retrieval
│ Users        │         ├─ Stage 3: Reranking
│ Conversations│         ├─ Stage 4: CRAG Gate
│ Messages     │         └─ Stage 5: 3-Agent ReAct
│ Documents    │             ├─ Research Agent
│ Embeddings   │             ├─ Analyst Agent
│ Semantic     │             └─ Writer Agent
│ Cache        │
└──────────────┘         └───────────────┘
```

---

## 📁 Folder Structure & Responsibility Matrix

### **Web App Directories**

```
web-app/
│
├── src/
│   │
│   ├── app/                          # Next.js App Router (Pages + API Routes)
│   │   ├── page.tsx                  # Landing page (/)
│   │   ├── layout.tsx                # Root layout wrapper
│   │   ├── chat/[id]/page.tsx        # Chat page (main UI)
│   │   ├── admin/                    # Admin dashboard (ADMIN role only)
│   │   │   ├── dashboard/            # Metrics, cache health
│   │   │   ├── documents/            # Document ingest UI
│   │   │   └── pipeline-tester/      # Glass-box pipeline testing
│   │   ├── api/                      # API routes (backend handlers)
│   │   │   ├── chat/stream/route.ts  # SSE streaming chat endpoint
│   │   │   ├── trpc/[trpc]/route.ts  # tRPC server
│   │   │   ├── cron/                 # Vercel cron jobs
│   │   │   │   ├── cleanup-cache/    # 7-day cache expiration
│   │   │   │   └── process-ingest-jobs/  # Document ingestion queue
│   │   │   ├── auth/[...nextauth]/   # OAuth + magic link handlers
│   │   │   └── guest/                # Guest session management
│   │   ├── login/                    # Auth UI
│   │   ├── history/                  # Conversation history
│   │   └── settings/                 # User preferences
│   │
│   ├── server/                       # All backend code (runs on Node.js)
│   │   │
│   │   ├── rag/                      # RAG Pipeline (core logic)
│   │   │   ├── agents/               # 3 Agent Orchestrators
│   │   │   │   ├── orchestrator.ts   # Main entry: routes to agentic or standard
│   │   │   │   ├── research.ts       # Research Agent (ReAct loop)
│   │   │   │   └── analyst.ts        # Analyst Agent (structured matrix)
│   │   │   ├── retrieval/            # Hybrid retrieval pipeline
│   │   │   │   ├── dense.ts          # FAISS vector search (similarity)
│   │   │   │   ├── sparse.ts         # BM25 full-text search
│   │   │   │   ├── hybrid.ts         # Combines dense + sparse
│   │   │   │   ├── rrf.ts            # Reciprocal Rank Fusion
│   │   │   │   ├── reranker.ts       # Cross-encoder reranking
│   │   │   │   └── join.ts           # Parent-child chunk joining
│   │   │   ├── cache/                # Semantic caching
│   │   │   │   └── semantic-cache.ts # Query embedding → response cache
│   │   │   ├── memory/               # Conversation memory
│   │   │   │   └── summary-buffer.ts # Windowed conversation summary
│   │   │   ├── tools/                # Agent tools
│   │   │   │   └── web-search.ts     # DDGS web search fallback
│   │   │   ├── guardrail.ts          # Stage 0A: domain + safety filter
│   │   │   ├── stage-zero.ts         # Stage 0B: disambiguation
│   │   │   ├── query-expansion.ts    # Stage 1: generates sub-queries
│   │   │   ├── crag-gate.ts          # Stage 4: confidence gate
│   │   │   ├── chat-pipeline.ts      # Main orchestration entry
│   │   │   ├── pipeline.ts           # Standard CRAG pipeline
│   │   │   ├── instance.ts           # Singleton retriever instance
│   │   │   └── types.ts              # Domain types (Chunk, Source, etc)
│   │   │
│   │   ├── ingest/                   # Document ingestion pipeline
│   │   │   ├── pipeline.ts           # Main ingest coordinator
│   │   │   ├── scraper.ts            # URL → HTML → text
│   │   │   ├── pdf-parser.ts         # PDF → text + metadata
│   │   │   ├── chunker.ts            # Text → parent/child chunks
│   │   │   ├── jobs.ts               # Background job worker
│   │   │   ├── cleaner.ts            # Cache invalidation on sync
│   │   │   └── cli.ts                # CLI entry (pnpm ingest)
│   │   │
│   │   ├── db/                       # Database utilities
│   │   │   ├── vector-queries.ts     # Raw pgvector SQL (safe, centralized)
│   │   │   ├── analytics.ts          # Admin dashboard queries
│   │   │   └── mapping.ts            # Row ↔ Domain object mapping
│   │   │
│   │   ├── routers/                  # tRPC routers (RPC endpoints)
│   │   │   ├── chat.ts               # Chat mutations + queries
│   │   │   ├── conversation.ts       # Conversation CRUD
│   │   │   ├── admin.ts              # Admin-only metrics
│   │   │   ├── document.ts           # Document management
│   │   │   ├── source.ts             # Citation sources
│   │   │   └── public.ts             # Public stats
│   │   │
│   │   ├── llm/                      # LLM provider abstraction
│   │   │   ├── client.ts             # Groq + HF fallback
│   │   │   ├── json.ts               # Structured JSON extraction
│   │   │   ├── circuit-breaker.ts    # Failure handling
│   │   │   ├── errors.ts             # LLM-specific errors
│   │   │   └── usage.ts              # Token tracking
│   │   │
│   │   ├── pii/                      # PII masking
│   │   │   └── masker.ts             # Regex + spaCy NER
│   │   │
│   │   ├── lib/                      # Shared utilities
│   │   │   ├── logger.ts             # Pino logging
│   │   │   ├── errors.ts             # Error types
│   │   │   ├── response.ts           # Response formatting
│   │   │   ├── conversation-policy.ts  # Guest limits + ownership
│   │   │   ├── security/             # Rate limiting
│   │   │   │   └── rate-limiter.ts   # ⚠️ Per-instance (needs Upstash)
│   │   │   └── errors/               # Error definitions
│   │   │
│   │   ├── embeddings/               # Embedding models
│   │   │   └── client.ts             # HF Inference or Gemini
│   │   │
│   │   ├── trpc/                     # tRPC configuration
│   │   │   ├── t.ts                  # Base procedure + auth middleware
│   │   │   ├── context.ts            # Request context (user, session)
│   │   │   └── router.ts             # Router aggregation
│   │   │
│   │   ├── auth.ts                   # NextAuth configuration
│   │   ├── db.ts                     # Prisma singleton
│   │   ├── env.ts                    # Environment validation
│   │   ├── guest.ts                  # Guest session logic
│   │   └── tracing.ts                # Langfuse integration
│   │
│   ├── config/                       # Centralized single-source config
│   │   └── app.ts                    #   Names, limits, pipeline tuning, model params
│   │
│   ├── lib/                          # Client-side utilities
│   │   ├── chat/types.ts             # Frontend chat types
│   │   ├── trpc/client.ts            # tRPC client setup
│   │   ├── conversation-groups.ts    # Group conversations by date
│   │   ├── guest.ts                  # Guest mode constants (re-exports from config)
│   │   ├── toast.tsx                 # Toast notifications
│   │   └── utils.ts                  # Helper functions
│   │
│   ├── components/                   # React components
│   │   ├── chat/                     # Chat UI
│   │   │   ├── chat-input.tsx        # Message input
│   │   │   ├── chat-bubble.tsx       # Message display
│   │   │   ├── disambiguation.tsx    # Stage-0B options
│   │   │   └── sources.tsx           # Citation display
│   │   ├── admin/                    # Admin components
│   │   ├── auth/                     # Auth UI
│   │   ├── sidebar/                  # Navigation
│   │   ├── ui/                       # Base UI (buttons, inputs, etc)
│   │   └── landing/                  # Home page hero
│   │
│   ├── hooks/                        # React hooks
│   │   ├── use-chat.ts               # Chat state management
│   │   └── use-debounce.ts           # Input debouncing
│   │
│   ├── styles/                       # Global CSS
│   │   └── globals.css               # Tailwind directives
│   │
│   └── middleware.ts                 # Next.js middleware (auth guards)
│
├── prisma/
│   ├── schema.prisma                 # Database schema
│   └── migrations/                   # Schema versioning
│
├── tests/
│   ├── unit/                         # Vitest unit tests
│   ├── integration/                  # Integration tests (real DB)
│   ├── e2e/                          # Playwright E2E tests
│   └── helpers/                      # Test fixtures
│
├── docker/
│   └── postgres-init.sql             # DB role + extension setup
│
└── docs/
    ├── security/                     # Security exceptions log
    ├── status/                       # Phase delivery reports
    └── ROADMAP.md                    # Future work
```

---

## 🔄 Data Flow & Request Lifecycle

### **Scenario: User sends a chat message**

```
1. FRONTEND (React Component)
   ├─ User types in <ChatInput />
   └─ Hits POST /api/chat/stream

2. API ROUTE (stream/route.ts)
   ├─ Validates: auth + guest limit + rate limit
   ├─ Parses: conversationId, query, mode
   └─ Opens SSE stream → runChatStream()

3. CHAT PIPELINE (rag/chat-pipeline.ts)
   ├─ Stage 0A: Guardrail (isQueryOutOfDomain?)
   │  └─ Checks: negative terms cache → LLM classifier
   ├─ Stage 0B: Disambiguation (≤3 words vague?)
   │  └─ Returns: 3 clarification options → emit via SSE
   └─ Cache check (semantic cosine ≥0.93?)
      └─ HIT: return cached response → DONE
      └─ MISS: proceed to retrieval

4. RETRIEVAL (rag/retrieval/hybrid.ts)
   ├─ Query expansion → 3 sub-queries
   ├─ Dense search: FAISS vector similarity (k=15)
   ├─ Sparse search: BM25 full-text (k=15)
   ├─ Fusion: RRF (Reciprocal Rank Fusion)
   ├─ Reranking: Cross-encoder (top-5)
   └─ Chunks: [(id, text, embedding, score)]

5. CRAG GATE (rag/crag-gate.ts)
   ├─ Average cross-score ≥0.50?
   │  └─ YES → Proceed to agents
   │  └─ NO → Fallback to web search (DDGS)
   └─ Return: ranked chunks + retrieval path

6. AGENT ORCHESTRATOR (rag/agents/orchestrator.ts)
   ├─ Mode: "STANDARD" or "AGENTIC"
   │  ├─ STANDARD: Direct LLM generation from chunks
   │  └─ AGENTIC: 3-Agent ReAct pipeline
   └─ For AGENTIC:
      ├─ Research Agent: tool-calling loop (FAISS, web)
      ├─ Analyst Agent: 5-dimensional matrix comparison
      └─ Writer Agent: Executive summary markdown

7. LLM GENERATION (llm/client.ts)
   ├─ Call Groq API (primary) or HF (fallback)
   ├─ Structured output: Zod validation
   └─ Token usage tracking via Langfuse

8. RESPONSE ASSEMBLY
   ├─ Format: markdown with citations
   ├─ Sources: extract from chunks
   ├─ Metadata: latency, path, cache status
   └─ Emit via SSE → FRONTEND

9. PERSISTENCE (routers/conversation.ts → database)
   ├─ Save: Message (USER/ASSISTANT)
   ├─ Save: Sources (JSON blob)
   ├─ Save: Metadata (isCached, mode, latencyMs)
   ├─ Update: Semantic cache entry
   ├─ Update: Conversation memory (summary)
   └─ Emit: updated conversation state → tRPC

10. FRONTEND RENDER
    ├─ Receive SSE chunks
    ├─ Stream markdown into <ChatBubble />
    ├─ Display sources
    └─ Show conversation in history
```

---

## 🏗️ Architectural Layers & Responsibilities

### **Layer 1: Presentation (React Components)**

**What:** User-facing UI
**Where:** `src/components/`, `src/hooks/`, `src/lib/`
**Key Files:**
- `ChatInput` → sends message
- `ChatBubble` → renders response
- `Sidebar` → conversation list
- `AdminDashboard` → metrics

**Rules:**
- ✅ Use tRPC client hooks (`useQuery`, `useMutation`)
- ✅ Keep state in `use-chat.ts` hook
- ✅ Delegate API calls to server
- ❌ No direct database access
- ❌ No LLM logic in components

---

### **Layer 2: API Routes (Next.js Route Handlers)**

**What:** Entry points for HTTP requests
**Where:** `src/app/api/`
**Key Files:**
- `/chat/stream/route.ts` — SSE streaming
- `/trpc/[trpc]/route.ts` — tRPC handler
- `/cron/*` — Scheduled jobs
- `/auth/[...nextauth]/route.ts` — OAuth

**Rules:**
- ✅ Validate input (Zod schemas)
- ✅ Check authorization (user roles)
- ✅ Call server functions
- ✅ Stream responses (SSE for long operations)
- ❌ Don't contain business logic (delegate to `server/rag`, `server/routers`)
- ❌ Don't query database directly (use Prisma via `server/db.ts`)

---

### **Layer 3: Business Logic (tRPC Routers & RAG)**

**What:** Core domain logic (retrieval, generation, orchestration)
**Where:** `src/server/routers/`, `src/server/rag/`
**Key Files:**
- `rag/chat-pipeline.ts` — Orchestrates the RAG stages
- `rag/retrieval/hybrid.ts` — Hybrid search
- `rag/agents/orchestrator.ts` — Agent routing
- `routers/conversation.ts` — Conversation CRUD
- `routers/chat.ts` — Chat mutations

**Rules:**
- ✅ Pure business logic (no HTTP headers, no Response objects)
- ✅ Parameterized functions with clear inputs/outputs
- ✅ Use dependency injection (pass `prisma`, `retriever`, etc)
- ✅ Async/await with proper error handling
- ❌ Don't return `NextResponse()` (that's for API routes)
- ❌ Don't couple to HTTP details

---

### **Layer 4: Data Access (Prisma ORM + Vector Queries)**

**What:** Database CRUD and vector operations
**Where:** `src/server/db/`, `prisma/`
**Key Files:**
- `db.ts` — Prisma singleton
- `db/vector-queries.ts` — Raw pgvector SQL (centralized, safe)
- `db/analytics.ts` — Admin dashboard aggregations
- `prisma/schema.prisma` — Schema definition
- `prisma/migrations/` — Version control

**Rules:**
- ✅ All raw SQL in `vector-queries.ts` (single source of truth)
- ✅ Use parameterized queries (`Prisma.sql`)
- ✅ Validate vectors before insertion
- ✅ Index foreign keys for performance
- ❌ No dynamic query building
- ❌ No raw strings in SQL

---

### **Layer 5: External Services (LLM, Embeddings, Web Search)**

**What:** Third-party API calls
**Where:** `src/server/llm/`, `src/server/embeddings/`, `src/server/rag/tools/`
**Key Files:**
- `llm/client.ts` — Groq + HF fallback
- `llm/circuit-breaker.ts` — Failure handling
- `embeddings/client.ts` — HF Inference or Gemini
- `rag/tools/web-search.ts` — DDGS web search

**Rules:**
- ✅ Centralize provider logic (abstract away APIs)
- ✅ Implement circuit breakers for resilience
- ✅ Use Langfuse for observability
- ✅ Validate structured outputs (Zod)
- ❌ Don't hardcode API calls across codebase

---

## 🔍 Key Design Patterns Used

### **1. Dependency Injection**

```typescript
// ✅ GOOD: Pass dependencies as arguments
async function runStandardCrag(
  question: string,
  options: {
    hybridRetriever: HybridRetriever,
    cache: SemanticCache,
    memory: SummaryBufferMemory,
  }
) { ... }

// ❌ BAD: Global singletons everywhere
const retriever = new HybridRetriever(); // created inside function
```

---

### **2. Single Responsibility Principle (SRP)**

Each module does ONE thing:
- `dense.ts` — Only FAISS search
- `sparse.ts` — Only BM25 search
- `hybrid.ts` — Only combines dense + sparse
- `rrf.ts` — Only Reciprocal Rank Fusion

**NOT:** One giant `retrieval.ts` doing everything

---

### **3. Error Boundaries**

```typescript
// ✅ Clear error types
export class DomainGuardBlockedError extends Error { }
export class GuestLimitReachedError extends Error { }

// Routers map errors to HTTP status codes
if (error instanceof GuestLimitReachedError) {
  return 403;
}
```

---

### **4. Type Safety (End-to-End)**

- TypeScript throughout
- Prisma generates types from schema
- tRPC validates at API boundary
- Zod schemas for runtime validation

```typescript
// Router procedure is typed:
export const chat = protectedProcedure
  .input(chatInputSchema)  // Type-checked input
  .output(chatOutputSchema)  // Type-checked output
  .mutation(async ({ input }) => { ... })

// Client gets types for free:
const { mutate } = trpc.chat.useMutation()
//     ↑ TypeScript knows argument shape automatically
```

---

### **5. Layered Caching**

- **L1:** Semantic cache (pgvector cosine ≥0.93)
- **L2:** Conversation memory (summarized context)
- **L3:** Vector index (pre-embedded chunks)

---

## 📈 Current Issues & Optimization Roadmap

### **🟡 Issues to Address (Medium Priority)**

| Issue | Impact | Fix |
|-------|--------|-----|
| **Rate limiter is per-instance** | Distributed attacks bypass limits on Vercel | Must set `UPSTASH_REDIS_URL` in production |
| **Guardrail uses LLM, not classifier** | Prompt injection possible | Fine-tune BERT text classifier (PHASE 2) |
| **Ingest pipeline runs synchronously** | 60s timeout risk with large corpora | Migrate to background queue (PHASE 2) |
| **Message.sources is JSON blob** | Can't query citations by SQL | Normalise to `MessageSource` relation (PHASE 3) |

### **🟢 Current Strengths**

✅ Parameterized SQL (no injection risk)  
✅ PoLP database roles (least privilege)  
✅ Type-safe tRPC (eliminates REST contract bugs)  
✅ Clear separation of concerns  
✅ Comprehensive test suite (249 test files)  
✅ CI/CD with security gates (Gitleaks, Semgrep, CodeQL)  

---

## 🚀 Professional Standard Checklist

### **Your Current Score: 8/10**

| Criterion | Status | Notes |
|-----------|--------|-------|
| **Clear folder structure** | ✅ | Each folder has single responsibility |
| **Documented patterns** | ⚠️ | Good code, needs architecture guide (this doc!) |
| **Type safety** | ✅ | TypeScript + Zod end-to-end |
| **Database schema** | ✅ | Normalized, indexed, role-based access |
| **No hardcoded secrets** | ✅ | All in `.env`, validated |
| **Async/await patterns** | ✅ | Proper error handling, no orphaned promises |
| **Error handling** | ✅ | Typed errors, mapped to HTTP status codes |
| **Testing** | ✅ | Unit + integration + E2E (249 files) |
| **Observability** | ✅ | Langfuse tracing + Pino logging |
| **Security posture** | ✅ | Parameterized SQL, PII masking, rate limiting |

---

## 🎯 Next Steps: Make a Change

### **For any developer reading this:**

1. **Identify what you're changing** → Find the folder from the matrix above
2. **Understand the dependencies** → Check the data flow diagram
3. **Follow the layer rules** → Don't put business logic in API routes
4. **Run tests** → `pnpm test` before committing
5. **Update this doc if you add a new pattern** → Keep it in sync

### **Example: "Add a new retrieval method"**

1. Create `src/server/rag/retrieval/keyword.ts`
2. Implement `KeywordRetriever` interface
3. Wire it in `src/server/rag/retrieval/hybrid.ts`
4. Add tests in `tests/integration/retrieval.test.ts`
5. Update this doc with the new responsibility

---

## 📚 Related Documentation

- `README.md` — Quick start
- `docs/STARTUP.md` — Local development setup
- `docs/security/SECURITY_EXCEPTIONS.md` — Known limitations
- `../CHANGELOG.md` — Release history
- `prisma/schema.prisma` — Database schema (source of truth)
- [`tests/README.md`](../../mvp-python/tests/README.md) — Web-app vs Python test-suite split, how to run each, CI ownership

---

## 🧠 Prompting Strategy (Centralized Contract)

All generation agents share **one versioned, unit-tested prompt contract** in `src/server/rag/prompt.ts` so safety/grounding rules cannot drift between surfaces:

| Rule | Standard pipeline | Agentic writer | Analyst | Guardrail |
|------|-------------------|----------------|---------|-----------|
| Grounded-only (never invent figures/timelines) | ✅ base | ✅ base | ✅ `verified_facts` traceable | — |
| Uncertainty → say so + point to official source | ✅ base | ✅ base | — | — |
| Answer in the user's language | ✅ base | ✅ base | ✅ | — |
| PII re-check (never echo/emit IBAN/passport/phone/email) | ✅ base | ✅ base | — | — |
| Safety (refuse circumvention/fraud of immigration law) | ✅ base | ✅ base | — | ✅ term cache + LLM |
| Ungrounded/fallback → "verify with official source" | ✅ | ✅ | — | — |
| Citations: every factual claim mapped to a source | — | ✅ `WRITER_CITATION_CONTRACT` | — | — |
| Untrusted-context handling (prompt injection) | — | — | ✅ | ✅ |

- `buildStandardSystemPrompt()` is the single `system` message for the standard CRAG path.
- `buildWriterPrompt()` = base + citation contract + format contract (subheadings, "Actionable Next Steps").
- `RESEARCH_AGENT_INSTRUCTION` documents the (currently deterministic) research agent's intended framing for any future LLM-based research step.
- Contract assertions live in `tests/unit/rag-prompt.test.ts` — a weakening edit fails CI.

---

**Last Updated:** 2026-08-10  
**Architecture Review Status:** COMPLETE ✅
