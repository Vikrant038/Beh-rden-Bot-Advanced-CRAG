# WEB_APP_PLAN.md
## Behörden-Bot Web — Greenfield Full-Stack Architecture & Implementation Plan

> **Scope:** Build a production-grade modern web application from scratch that reimplements the core business logic of the existing Behörden-Bot (Repo-2) Python/Streamlit codebase. The original repository is **never modified**. This plan covers every architectural decision, technology choice, schema design, route map, and implementation phase.

---

## Table of Contents

1. [Design Philosophy](#1-design-philosophy)
2. [Technology Stack](#2-technology-stack)
3. [Repository Structure](#3-repository-structure)
4. [Page & Route Map](#4-page--route-map)
5. [Database Schema (Prisma)](#5-database-schema-prisma)
6. [API Architecture](#6-api-architecture)
7. [RAG Pipeline Strategy](#7-rag-pipeline-strategy)
8. [Authentication & Authorization](#8-authentication--authorization)
9. [UI/UX Design System](#9-uiux-design-system)
10. [Real-Time & Streaming](#10-real-time--streaming)
11. [Observability & Monitoring](#11-observability--monitoring)
12. [Testing Strategy](#12-testing-strategy)
13. [Deployment & Infrastructure](#13-deployment--infrastructure)
14. [Implementation Roadmap](#14-implementation-roadmap)
15. [Open Questions](#15-open-questions)

---

## 1. Design Philosophy

| Principle | Implementation |
|-----------|---------------|
| **Never touch Repo-2** | Greenfield repo. Zero imports from original. Business logic reimplemented in TypeScript. |
| **Feature parity first** | Every feature from the analysis (3-agent, CRAG, cache, memory, PII, guardrails) is reimplemented. |
| **TypeScript everywhere** | Strict mode. Shared types between client and server. No `any`. |
| **Server-first rendering** | Next.js App Router with RSC. Client components only where interactivity is needed. |
| **Edge-ready API** | tRPC for type-safe API calls. SSE streaming for chat responses. |
| **Premium UX** | Dark-first design, glassmorphism, micro-animations, mobile-responsive from day one. |

---

## 2. Technology Stack

### Core Framework
| Layer | Choice | Rationale |
|-------|--------|-----------|
| Framework | **Next.js 15** (App Router) | RSC, streaming, API routes, middleware, Vercel-native |
| Language | **TypeScript 5.x** (strict) | End-to-end type safety, shared types client↔server |
| Runtime | **Node.js 22 LTS** | Native fetch, performance improvements |

### Data Layer
| Layer | Choice | Rationale |
|-------|--------|-----------|
| ORM | **Prisma 6** | Type-safe queries, migrations, pgvector extension support |
| Database | **PostgreSQL 16 + pgvector** | Vector similarity search, same as original — full parity |
| Hosting | **Neon** (serverless PostgreSQL) | Free tier, pgvector native, branching for dev/staging |
| Cache | **Upstash Redis** | Semantic cache Tier 1 (exact hash), rate limiting, session store |

### API & Communication
| Layer | Choice | Rationale |
|-------|--------|-----------|
| API | **tRPC v11** | End-to-end TypeScript type safety, no codegen, SSE support |
| Streaming | **Server-Sent Events** via tRPC subscription or Next.js Route Handler | Real-time token streaming for chat |
| Validation | **Zod** | Runtime validation + TypeScript inference, used by both tRPC and Prisma |

### Authentication
| Layer | Choice | Rationale |
|-------|--------|-----------|
| Auth | **NextAuth.js v5** (Auth.js) | Self-hosted, multiple providers, JWT sessions, free |
| Providers | GitHub + Google + Email magic link | Covers developer and student audiences |

### UI & Styling
| Layer | Choice | Rationale |
|-------|--------|-----------|
| CSS | **Tailwind CSS v4** | User explicitly requested; utility-first, dark mode built-in |
| Components | **shadcn/ui** | Headless, accessible, customizable — not a dependency but copied components |
| Animation | **Framer Motion** | Smooth page transitions, micro-interactions, streaming text animations |
| Icons | **Lucide React** | Consistent, tree-shakeable, used by shadcn/ui |
| Fonts | **Inter** (body) + **JetBrains Mono** (code) | Modern, clean, excellent legibility |
| Charts | **Recharts** | For admin dashboard metrics visualization |

### AI / ML Layer
| Layer | Choice | Rationale |
|-------|--------|-----------|
| LLM Client | **Vercel AI SDK** (`ai` package) | Unified streaming interface, provider-agnostic, SSE built-in |
| Primary LLM | **Groq** (llama-3.1-8b-instant) | Same as original — 14.4k req/day free, 800 tok/s |
| Fallback LLM | **HuggingFace Inference** | Same circuit-breaker failover pattern |
| Embeddings | **Transformers.js** (server-side) OR **HF Inference API** | BGE-base-en-v1.5 768d embeddings without Python |
| Vector Search | **pgvector** (via Prisma raw queries) | Cosine similarity search directly in PostgreSQL |
| Web Search | **DuckDuckGo** (via `duck-duck-scrape`) | CRAG fallback — same as original |

### Testing
| Layer | Choice | Rationale |
|-------|--------|-----------|
| Unit | **Vitest** | Fast, TypeScript-native, Jest-compatible |
| Integration | **Vitest + Prisma test utils** | Database integration tests with test containers |
| E2E | **Playwright** | Cross-browser, visual regression, accessibility |
| API | **tRPC test client** | Type-safe API testing |

### DevOps
| Layer | Choice | Rationale |
|-------|--------|-----------|
| Deployment | **Vercel** | Next.js native, edge functions, preview deploys |
| Database | **Neon PostgreSQL** (pgvector) | Serverless, free tier, auto-suspend |
| Redis | **Upstash** | Serverless, free tier, REST API |
| CI/CD | **GitHub Actions** | Lint + test + Playwright + deploy |
| Monitoring | **Vercel Analytics** + **Langfuse** | Web vitals + LLM observability |

---

## 3. Repository Structure

```
behoerden-bot-web/
├── .github/
│   └── workflows/
│       ├── ci.yml                    # Lint + typecheck + unit tests
│       ├── e2e.yml                   # Playwright E2E tests
│       └── deploy.yml                # Vercel production deploy
├── prisma/
│   ├── schema.prisma                 # Database schema (7 models)
│   ├── migrations/                   # Auto-generated migrations
│   └── seed.ts                       # Seed script (sample documents + test user)
├── public/
│   ├── fonts/                        # Inter + JetBrains Mono (self-hosted)
│   └── og-image.png                  # Open Graph social preview image
├── src/
│   ├── app/                          # Next.js App Router pages
│   │   ├── layout.tsx                # Root layout (theme provider, fonts, metadata)
│   │   ├── page.tsx                  # Landing page (hero + feature showcase)
│   │   ├── globals.css               # Tailwind directives + CSS custom properties
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx        # Login page (OAuth + magic link)
│   │   │   └── register/page.tsx     # Registration page
│   │   ├── (app)/                    # Authenticated app layout group
│   │   │   ├── layout.tsx            # App shell (sidebar + header)
│   │   │   ├── chat/
│   │   │   │   ├── page.tsx          # New chat (redirect to /chat/[id])
│   │   │   │   └── [id]/page.tsx     # Active chat conversation
│   │   │   ├── history/page.tsx      # Conversation history list
│   │   │   ├── sources/page.tsx      # Knowledge base browser
│   │   │   └── settings/page.tsx     # User preferences
│   │   ├── admin/                    # Admin-only pages
│   │   │   ├── layout.tsx            # Admin guard middleware
│   │   │   ├── dashboard/page.tsx    # Usage metrics, cache stats
│   │   │   └── documents/page.tsx    # Document sync management
│   │   └── api/
│   │       ├── trpc/[trpc]/route.ts  # tRPC HTTP handler
│   │       ├── auth/[...nextauth]/route.ts  # NextAuth handler
│   │       └── chat/stream/route.ts  # SSE streaming endpoint
│   ├── components/
│   │   ├── ui/                       # shadcn/ui primitives (button, input, dialog, etc.)
│   │   ├── chat/
│   │   │   ├── ChatInterface.tsx     # Main chat container
│   │   │   ├── MessageBubble.tsx     # Individual message (user/assistant)
│   │   │   ├── StreamingText.tsx     # Animated token-by-token text renderer
│   │   │   ├── DisambiguationCard.tsx # Stage-0 clarifying options (3 buttons)
│   │   │   ├── SourceCitation.tsx    # Expandable source reference
│   │   │   ├── AnalysisMatrix.tsx    # Analyst agent's 5-dim comparison table
│   │   │   └── TypingIndicator.tsx   # Animated "thinking" dots
│   │   ├── layout/
│   │   │   ├── AppSidebar.tsx        # Collapsible sidebar (conversations + nav)
│   │   │   ├── Header.tsx            # Top bar (user menu, theme toggle)
│   │   │   └── MobileNav.tsx         # Bottom nav for mobile
│   │   ├── landing/
│   │   │   ├── Hero.tsx              # Hero section with animated gradient
│   │   │   ├── FeatureGrid.tsx       # Feature cards with hover effects
│   │   │   └── TechStack.tsx         # Technology badges
│   │   └── shared/
│   │       ├── ThemeProvider.tsx      # Dark/light mode context
│   │       ├── LoadingSkeleton.tsx    # Content loading placeholders
│   │       └── ErrorBoundary.tsx      # Graceful error handling
│   ├── server/
│   │   ├── trpc/
│   │   │   ├── router.ts            # Root tRPC router
│   │   │   ├── context.ts           # tRPC context (auth, db)
│   │   │   └── routers/
│   │   │       ├── chat.ts           # Chat mutations (send message, create conversation)
│   │   │       ├── conversation.ts   # Conversation CRUD + history
│   │   │       ├── document.ts       # Document sync (admin only)
│   │   │       ├── source.ts         # Knowledge base browsing
│   │   │       └── admin.ts          # Admin metrics + cache management
│   │   ├── rag/
│   │   │   ├── pipeline.ts           # Main RAG orchestrator (mode: standard | agentic)
│   │   │   ├── retrieval.ts          # Hybrid retrieval (pgvector dense + BM25 sparse)
│   │   │   ├── reranker.ts           # Cross-encoder reranking via HF Inference API
│   │   │   ├── crag-gate.ts          # CRAG confidence gate (threshold >= 0.50)
│   │   │   ├── agents/
│   │   │   │   ├── research.ts       # Agent 1: ReAct research loop
│   │   │   │   ├── analyst.ts        # Agent 2: 5-dim comparison matrix
│   │   │   │   └── writer.ts         # Agent 3: Executive markdown synthesis
│   │   │   ├── tools/
│   │   │   │   ├── vector-search.ts  # FAISS-equivalent pgvector search tool
│   │   │   │   ├── web-search.ts     # DuckDuckGo CRAG fallback
│   │   │   │   └── visa-calculator.ts # Deterministic EUR/INR calculator
│   │   │   ├── guardrail.ts          # Domain + safety classifier
│   │   │   ├── disambiguation.ts     # Stage-0 vague query handler
│   │   │   └── query-expansion.ts    # Multi-query LLM expansion
│   │   ├── llm/
│   │   │   ├── client.ts             # Resilient LLM client (Groq + HF, circuit breaker)
│   │   │   ├── circuit-breaker.ts    # TypeScript circuit breaker implementation
│   │   │   └── providers.ts          # Provider configuration (Groq, HF)
│   │   ├── cache/
│   │   │   ├── semantic-cache.ts     # Multi-tier cache (Redis exact + pgvector cosine)
│   │   │   └── negative-cache.ts     # Out-of-domain instant rejection
│   │   ├── memory/
│   │   │   └── summary-buffer.ts     # Summary-buffer conversational memory
│   │   ├── security/
│   │   │   ├── pii-masker.ts         # GDPR PII regex masking (TypeScript port)
│   │   │   └── rate-limiter.ts       # Upstash Redis sliding-window rate limiter
│   │   ├── embeddings/
│   │   │   └── client.ts             # Embedding generation (HF Inference API)
│   │   └── db.ts                     # Prisma client singleton
│   ├── lib/
│   │   ├── utils.ts                  # cn() helper, formatters
│   │   ├── constants.ts              # App-wide constants (thresholds, limits)
│   │   └── validators.ts             # Zod schemas (shared client/server)
│   ├── hooks/
│   │   ├── useChat.ts                # Chat SSE streaming hook
│   │   ├── useConversations.ts       # Conversation list + CRUD
│   │   └── useTheme.ts              # Theme toggle hook
│   ├── types/
│   │   ├── chat.ts                   # Message, Conversation, Source types
│   │   ├── rag.ts                    # RAG pipeline types (agents, tools, matrix)
│   │   └── api.ts                    # API request/response types
│   └── env.ts                        # Type-safe env var validation (t3-env)
├── tests/
│   ├── unit/
│   │   ├── pii-masker.test.ts
│   │   ├── circuit-breaker.test.ts
│   │   ├── visa-calculator.test.ts
│   │   ├── negative-cache.test.ts
│   │   └── query-expansion.test.ts
│   ├── integration/
│   │   ├── retrieval.test.ts
│   │   ├── semantic-cache.test.ts
│   │   └── rag-pipeline.test.ts
│   └── e2e/
│       ├── chat-flow.spec.ts
│       ├── auth.spec.ts
│       └── admin.spec.ts
├── .env.example
├── .env.local                        # Local secrets (gitignored)
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── vitest.config.ts
├── playwright.config.ts
├── package.json
└── README.md
```

---

## 4. Page & Route Map

### Public Pages
| Route | Page | Purpose |
|-------|------|---------|
| `/` | Landing | Hero + feature showcase + CTA "Start Chatting" |
| `/login` | Login | OAuth (GitHub, Google) + email magic link |
| `/register` | Register | Account creation |

### Authenticated App Pages
| Route | Page | Purpose |
|-------|------|---------|
| `/chat` | New Chat | Creates new conversation, redirects to `/chat/[id]` |
| `/chat/[id]` | Active Chat | Main chat interface with streaming, sources, disambiguation |
| `/history` | History | Paginated list of past conversations (search, filter, delete) |
| `/sources` | Knowledge Base | Browse indexed documents, chunk counts, source metadata |
| `/settings` | Settings | Theme, default engine mode, notification preferences |

### Admin Pages (role: ADMIN only)
| Route | Page | Purpose |
|-------|------|---------|
| `/admin/dashboard` | Dashboard | Usage metrics (queries/day, cache hit rate, avg latency, agent usage) |
| `/admin/documents` | Documents | Upload/sync documents, view ingestion status, trigger re-embed |

### API Routes
| Route | Method | Purpose |
|-------|--------|---------|
| `/api/trpc/*` | POST/GET | tRPC handler (all typed procedures) |
| `/api/auth/*` | GET/POST | NextAuth.js handler |
| `/api/chat/stream` | POST | SSE streaming endpoint for chat responses |

---

## 5. Database Schema (Prisma)

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions"]
}

datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  extensions = [vector]
}

// ─── Authentication ────────────────────────────────────────

model User {
  id            String    @id @default(cuid())
  name          String?
  email         String    @unique
  emailVerified DateTime?
  image         String?
  role          Role      @default(USER)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  accounts      Account[]
  sessions      Session[]
  conversations Conversation[]

  @@map("users")
}

model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String?
  access_token      String?
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
  @@map("accounts")
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("sessions")
}

enum Role {
  USER
  ADMIN
}

// ─── Conversations & Messages ──────────────────────────────

model Conversation {
  id        String   @id @default(cuid())
  title     String?  // Auto-generated from first message
  userId    String
  mode      EngineMode @default(AGENTIC)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user     User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  messages Message[]
  memory   ConversationMemory?

  @@index([userId, updatedAt(sort: Desc)])
  @@map("conversations")
}

model Message {
  id             String   @id @default(cuid())
  conversationId String
  role           MessageRole
  content        String
  metadata       Json?    // {latency_ms, retrieval_path, agent_steps, is_cached, pii_detected}
  sources        Json?    // [{source_name, source_url, relevance_score, text_preview}]
  createdAt      DateTime @default(now())

  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@index([conversationId, createdAt])
  @@map("messages")
}

enum MessageRole {
  USER
  ASSISTANT
  SYSTEM
  DISAMBIGUATION  // Stage-0 clarification options
}

enum EngineMode {
  STANDARD  // Standard CRAG
  AGENTIC   // 3-Agent ReAct
}

// ─── Conversational Memory ─────────────────────────────────

model ConversationMemory {
  id             String   @id @default(cuid())
  conversationId String   @unique
  summaryText    String   @default("")  // LLM-compressed rolling summary
  updatedAt      DateTime @updatedAt

  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@map("conversation_memories")
}

// ─── Knowledge Base ────────────────────────────────────────

model DocumentChunk {
  id         Int      @id @default(autoincrement())
  sourceName String
  sourceUrl  String
  text       String
  embedding  Unsupported("vector(768)")
  createdAt  DateTime @default(now())

  @@index([sourceName])
  @@map("document_chunks")
}

// ─── Semantic Cache ────────────────────────────────────────

model SemanticCacheEntry {
  id           Int      @id @default(autoincrement())
  queryHash    String   @unique  // SHA-256 of normalized query
  queryText    String
  queryVector  Unsupported("vector(768)")
  responseJson Json     // {answer, sources}
  parentDocIds String[] // Source names for cache invalidation
  createdAt    DateTime @default(now())
  expiresAt    DateTime // created_at + 7 days (enforced TTL)

  @@index([queryHash])
  @@index([expiresAt])  // For TTL cleanup cron
  @@map("semantic_cache")
}
```

### Key Differences from Original
| Aspect | Original (Python) | New (TypeScript) |
|--------|-------------------|------------------|
| Auth | None | Full User/Account/Session models (NextAuth) |
| Conversations | Flat session_memory table | Normalized Conversation → Message + Memory |
| Cache TTL | Column exists, never enforced | `expiresAt` column with indexed cleanup cron |
| Roles | None | USER / ADMIN enum |
| Message metadata | Lost on refresh | Persisted in Message.metadata JSON |
| Disambiguation | Not stored | Stored as MessageRole.DISAMBIGUATION |

---

## 6. API Architecture

### tRPC Routers

```
appRouter
├── chat
│   ├── sendMessage      # mutation: send query, returns messageId (response streams via SSE)
│   └── regenerate       # mutation: re-run last assistant message
├── conversation
│   ├── create           # mutation: new conversation
│   ├── list             # query: paginated user conversations (title, preview, updatedAt)
│   ├── getById          # query: single conversation with messages
│   ├── updateTitle      # mutation: rename conversation
│   ├── delete           # mutation: soft-delete conversation
│   └── export           # query: export conversation as Markdown
├── source
│   ├── list             # query: all indexed document sources with chunk counts
│   └── getChunks        # query: paginated chunks for a source
├── document (admin)
│   ├── sync             # mutation: transactional document sync (re-chunk + re-embed + cache invalidate)
│   ├── ingestUrl        # mutation: scrape URL and ingest
│   └── delete           # mutation: remove document + chunks + invalidate cache
├── admin (admin)
│   ├── metrics          # query: usage stats (queries/day, cache hits, avg latency)
│   ├── clearCache       # mutation: wipe semantic cache
│   └── users            # query: user list with conversation counts
```

### SSE Streaming Endpoint

`POST /api/chat/stream` — Separate from tRPC because tRPC subscriptions require WebSockets, but SSE is simpler and Vercel-compatible.

```typescript
// Request body
{
  conversationId: string;
  query: string;
  mode: "standard" | "agentic";
  bypassCache?: boolean;
}

// SSE events emitted:
data: {"type": "status", "stage": "guardrail"}
data: {"type": "status", "stage": "retrieving"}
data: {"type": "status", "stage": "agent_research"}
data: {"type": "status", "stage": "agent_analyst"}
data: {"type": "status", "stage": "agent_writer"}
data: {"type": "token", "content": "The"}
data: {"type": "token", "content": " APS"}
data: {"type": "token", "content": " certificate"}
...
data: {"type": "disambiguation", "options": ["Option 1", "Option 2", "Option 3"]}
data: {"type": "done", "messageId": "...", "sources": [...], "metadata": {...}}
```

---

## 7. RAG Pipeline Strategy

### Reimplementation Approach

The entire RAG pipeline is reimplemented in TypeScript on the server side. No Python dependency.

```
src/server/rag/
├── pipeline.ts          → Orchestrates full flow (replaces agentic_rag.py + rag.py)
├── retrieval.ts         → pgvector dense + BM25 sparse + RRF fusion (replaces retrieval.py + advanced_retrieval.py)
├── reranker.ts          → HF Inference API cross-encoder call (replaces local model loading)
├── crag-gate.ts         → Threshold check (>= 0.50), web search fallback trigger
├── guardrail.ts         → LLM domain classifier (replaces embedded prompt in advanced_retrieval.py)
├── disambiguation.ts    → Vague query detection + option generation (properly implemented this time)
├── query-expansion.ts   → Multi-query LLM expansion
├── agents/
│   ├── research.ts      → ReAct loop: vector_search, web_search, visa_calculator tools
│   ├── analyst.ts       → Structured output (Zod-validated AnalystMatrix)
│   └── writer.ts        → Markdown synthesis with streaming
└── tools/
    ├── vector-search.ts → pgvector cosine similarity query (SQL)
    ├── web-search.ts    → DuckDuckGo scrape
    └── visa-calculator.ts → Deterministic EUR/INR calculation
```

### Key Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| **pgvector for dense search** (not FAISS) | Eliminates separate vector index. Single PostgreSQL database for everything. FAISS requires a Python runtime. |
| **HF Inference API for reranking** | Cross-encoder model (bge-reranker-base) is too large to run in Node.js. Call HF API for reranking. Adds ~200ms latency but eliminates ONNX/Python dependency. |
| **HF Inference API for embeddings** | BGE-base-en-v1.5 is 438MB. Use HF Inference API for embedding generation. Alternative: Transformers.js with quantized model if latency is critical. |
| **Vercel AI SDK for LLM streaming** | Provides unified streaming interface for Groq (OpenAI-compatible), handles backpressure, SSE encoding. |
| **BM25 in TypeScript** | Use `wink-bm25-text-search` npm package or custom implementation. Stateless — rebuilt per-request from pgvector chunks (fast for <1000 chunks). |
| **Circuit breaker in TypeScript** | Custom implementation (~50 lines) — no need for heavy library. State stored in-memory per serverless function instance. |

### Embedding Strategy

Two options (to be decided):

**Option A: HF Inference API (Recommended)**
- Call `https://api-inference.huggingface.co/pipeline/feature-extraction/BAAI/bge-base-en-v1.5`
- Latency: ~100-200ms per query
- No local model, no memory footprint
- Fine-tuned model: push to HF Hub, call that instead

**Option B: Transformers.js (Server-Side)**
- Load ONNX-quantized BGE model in Node.js
- Latency: ~50ms per query after cold start
- Cold start: ~5s (model load)
- Eliminates external API call

---

## 8. Authentication & Authorization

### NextAuth.js v5 Configuration

```
Providers:
  - GitHub OAuth
  - Google OAuth
  - Email (Magic Link via Resend)

Session Strategy: JWT (stateless, Vercel-compatible)
Database Adapter: Prisma (PostgreSQL)

Middleware:
  - /chat/* → requires auth
  - /history → requires auth
  - /settings → requires auth
  - /admin/* → requires auth + role: ADMIN
  - /api/chat/stream → requires auth (JWT in header)
  - /api/trpc/* → auth context injected via tRPC
```

### Authorization Rules

| Resource | USER | ADMIN |
|----------|------|-------|
| Chat (own conversations) | CRUD | CRUD (all users) |
| Conversation history | Read own | Read all |
| Sources/knowledge base | Read | Read + Write |
| Document sync | Denied | Full access |
| Cache management | Denied | Clear + view stats |
| User management | Denied | View + role change |

---

## 9. UI/UX Design System

### Design Tokens

```css
/* Color palette — Dark-first, premium feel */
--background:     hsl(222, 47%, 7%);       /* Deep navy (#0f172a) */
--surface:        hsl(222, 35%, 11%);      /* Slightly lighter navy */
--surface-hover:  hsl(222, 30%, 15%);      /* Hover state */
--border:         hsl(222, 20%, 20%);      /* Subtle borders */
--primary:        hsl(238, 80%, 67%);      /* Indigo-purple (#6366f1) */
--primary-hover:  hsl(238, 80%, 60%);
--accent:         hsl(200, 95%, 55%);      /* Cyan accent */
--success:        hsl(142, 71%, 45%);      /* Green for verified facts */
--warning:        hsl(38, 92%, 50%);       /* Amber for disclaimers */
--destructive:    hsl(0, 84%, 60%);        /* Red for errors */
--text:           hsl(210, 40%, 96%);      /* Off-white text */
--text-muted:     hsl(215, 20%, 55%);      /* Secondary text */
--glass:          rgba(255, 255, 255, 0.05); /* Glassmorphism fill */
--glass-border:   rgba(255, 255, 255, 0.08);
```

### Page Descriptions

**Landing Page (`/`)**
- Full-viewport hero with animated gradient mesh background (indigo → purple → cyan)
- Glassmorphic floating card with headline: "Your AI Guide to German Immigration"
- Feature grid: 6 cards (3-Agent ReAct, Hybrid Retrieval, CRAG Gate, Semantic Cache, PII Masking, Observability) with hover lift + glow effects
- CTA button with shimmer animation → `/login`

**Chat Page (`/chat/[id]`)**
- Two-panel layout: collapsible sidebar (conversation list) + main chat area
- Message bubbles: user (right, indigo) / assistant (left, surface with glass effect)
- Streaming text: character-by-character with blinking cursor animation
- Disambiguation: 3 animated card buttons with hover scale effect
- Sources: collapsible panel at bottom of each assistant message (slide-in animation)
- Analysis matrix: rendered as styled Markdown table inside message
- Status bar: animated pipeline stage indicator (Guardrail → Retrieving → Research → Analysis → Writing)
- Mobile: full-width chat, swipe-to-open sidebar, bottom input bar

**History Page (`/history`)**
- Searchable list with conversation title, preview, timestamp, engine mode badge
- Hover: shows delete button + export button
- Infinite scroll pagination
- Empty state: illustrated placeholder with "Start your first conversation" CTA

**Admin Dashboard (`/admin/dashboard`)**
- Metric cards: total queries, cache hit rate, avg latency, active users (animated counters)
- Charts: queries/day (line), cache hits vs misses (donut), engine mode split (bar)
- Recent queries table with latency, mode, cached status

### Micro-Animations
| Element | Animation | Library |
|---------|-----------|---------|
| Page transitions | Slide + fade | Framer Motion `AnimatePresence` |
| Message appear | Slide up + fade in | Framer Motion `motion.div` |
| Streaming text | Character reveal with cursor | Custom CSS animation |
| Disambiguation cards | Scale in staggered | Framer Motion `staggerChildren` |
| Status stages | Progress dot pulse | CSS keyframes |
| Sidebar toggle | Width slide | Framer Motion `layout` |
| Theme toggle | Rotate icon | Framer Motion `rotate` |
| Button hover | Scale 1.02 + shadow glow | Tailwind `hover:scale-[1.02]` + `transition` |
| Loading skeleton | Shimmer gradient | CSS keyframes |
| Source expand | Accordion slide | Framer Motion `AnimatePresence` |

---

## 10. Real-Time & Streaming

### SSE Architecture

```
Client (useChat hook)
  │
  ├── POST /api/chat/stream (Authorization: Bearer <JWT>)
  │   Body: { conversationId, query, mode, bypassCache }
  │
  │   ┌─────────────────────────────────────────────┐
  │   │ Server (Next.js Route Handler)               │
  │   │                                              │
  │   │ 1. Validate JWT → extract userId             │
  │   │ 2. PII mask query                            │
  │   │ 3. Save user message to DB                   │
  │   │ 4. Create ReadableStream                     │
  │   │ 5. Run RAG pipeline (async)                  │
  │   │    └── Emit SSE events as pipeline progresses│
  │   │ 6. Save assistant message to DB              │
  │   │ 7. Close stream                              │
  │   └─────────────────────────────────────────────┘
  │
  ◀── SSE: {"type":"status","stage":"guardrail"}
  ◀── SSE: {"type":"status","stage":"retrieving"}
  ◀── SSE: {"type":"token","content":"The "}
  ◀── SSE: {"type":"token","content":"APS "}
  ...
  ◀── SSE: {"type":"done","messageId":"...","sources":[...],"metadata":{...}}
```

### Client-Side Hook

```typescript
// Simplified useChat hook behavior
function useChat(conversationId: string) {
  // Returns: { messages, isStreaming, sendMessage, status }
  // sendMessage: opens SSE connection, appends tokens to current message
  // status: 'idle' | 'guardrail' | 'retrieving' | 'research' | 'analyst' | 'writer' | 'done'
}
```

---

## 11. Observability & Monitoring

| Layer | Tool | Tracks |
|-------|------|--------|
| LLM Traces | **Langfuse** | Span tree, token counts, latency, cost, TTFT, fallback events |
| Web Vitals | **Vercel Analytics** | LCP, INP, CLS, TTFB |
| Error Tracking | **Vercel (built-in)** | Runtime errors, function invocation failures |
| Rate Limiting | **Upstash Redis** | Sliding window per user (60 req/min default) |
| Custom Metrics | **Prisma queries** | Cache hit rate, avg latency, queries/day (admin dashboard) |

---

## 12. Testing Strategy

### Unit Tests (Vitest)
- PII masker regex patterns (port all original test cases)
- Circuit breaker state transitions
- Visa calculator math
- Negative cache term matching
- Query expansion prompt formatting
- RRF fusion algorithm
- BM25 scoring

### Integration Tests (Vitest + Prisma)
- Semantic cache: write → exact read → cosine read → TTL expiry
- Retrieval pipeline: embed → store → query → rank
- Conversation memory: add turns → prune → verify summary
- Document sync: ingest → embed → swap → verify cache invalidation

### E2E Tests (Playwright)
- Full chat flow: login → send message → receive streaming response → view sources
- Disambiguation flow: send vague query → see 3 options → click one → get answer
- Auth flow: login (GitHub/Google) → access chat → logout → redirect
- Admin flow: login as admin → view dashboard → sync document → clear cache
- Mobile responsive: chat on mobile viewport, sidebar swipe

### CI Quality Gate
- TypeScript: zero errors (`tsc --noEmit`)
- Lint: ESLint + Prettier (zero warnings)
- Unit + Integration: Vitest (all pass)
- E2E: Playwright (all pass)
- Bundle size: < 200KB first load JS

---

## 13. Deployment & Infrastructure

### Production Stack

```
┌───────────────────────────────────────┐
│           Vercel (Frontend + API)      │
│  ┌──────────┐  ┌────────────────────┐ │
│  │ Next.js  │  │ API Routes (Edge)  │ │
│  │ SSR/RSC  │  │ tRPC + SSE Stream  │ │
│  └──────────┘  └────────────────────┘ │
└──────────┬────────────────┬───────────┘
           │                │
    ┌──────▼──────┐  ┌──────▼──────┐
    │    Neon     │  │   Upstash   │
    │ PostgreSQL  │  │   Redis     │
    │ + pgvector  │  │ (cache/RL)  │
    └─────────────┘  └─────────────┘
           │
    ┌──────▼──────┐
    │  External   │
    │   APIs      │
    │ ┌─────────┐ │
    │ │  Groq   │ │
    │ │  HF API │ │
    │ │Langfuse │ │
    │ │  DDGS   │ │
    │ └─────────┘ │
    └─────────────┘
```

### Environment Variables

```env
# Database
DATABASE_URL=postgresql://...@....neon.tech/behoerden_bot?sslmode=require

# Auth
NEXTAUTH_URL=https://behoerden-bot.vercel.app
NEXTAUTH_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# LLM
GROQ_API_KEY=gsk_...
HF_TOKEN=hf_...

# Cache
UPSTASH_REDIS_URL=https://...
UPSTASH_REDIS_TOKEN=...

# Observability
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_HOST=https://cloud.langfuse.com

# Email (Magic Link)
RESEND_API_KEY=re_...
```

---

## 14. Implementation Roadmap

### Phase A: Foundation (3-4 days)
- [ ] Initialize Next.js 15 project with TypeScript strict
- [ ] Configure Tailwind CSS v4 + shadcn/ui
- [ ] Set up Prisma schema + Neon PostgreSQL + pgvector extension
- [ ] Run initial migration
- [ ] Set up NextAuth.js v5 (GitHub + Google providers)
- [ ] Create root layout, theme provider, font loading
- [ ] Build landing page (hero + feature grid)
- [ ] Set up tRPC with auth context
- [ ] Configure Vitest + Playwright

### Phase B: Core RAG Engine (5-7 days)
- [ ] Port PII masker (regex patterns) to TypeScript
- [ ] Implement LLM client (Groq + HF fallback + circuit breaker)
- [ ] Implement embedding client (HF Inference API)
- [ ] Build pgvector dense retrieval (SQL queries via Prisma.$queryRaw)
- [ ] Implement BM25 sparse retrieval in TypeScript
- [ ] Implement RRF fusion algorithm
- [ ] Implement cross-encoder reranking (HF Inference API call)
- [ ] Build CRAG confidence gate
- [ ] Implement domain guardrail (LLM classifier)
- [ ] Build query expansion (multi-query LLM)
- [ ] Implement Stage-0 disambiguation (vague query detection + option generation)
- [ ] Build visa calculator tool
- [ ] Build web search tool (DuckDuckGo)
- [ ] Implement negative cache (in-memory term set)
- [ ] Build semantic cache (Redis exact hash + pgvector cosine)
- [ ] Implement summary-buffer memory
- [ ] Build standard CRAG pipeline orchestrator
- [ ] Build 3-Agent ReAct pipeline (Research → Analyst → Writer)
- [ ] Write unit tests for all modules

### Phase C: Chat UI & Streaming (4-5 days)
- [ ] Build SSE streaming endpoint (`/api/chat/stream`)
- [ ] Build `useChat` client hook (SSE consumer)
- [ ] Build ChatInterface component
- [ ] Build MessageBubble (user + assistant variants)
- [ ] Build StreamingText component (token-by-token animation)
- [ ] Build DisambiguationCard (3-option selection)
- [ ] Build SourceCitation (expandable panel)
- [ ] Build AnalysisMatrix (Markdown table renderer)
- [ ] Build TypingIndicator
- [ ] Build pipeline status indicator (animated stage dots)
- [ ] Build AppSidebar (conversation list, collapsible)
- [ ] Build conversation CRUD (create, list, rename, delete, export)
- [ ] Build chat input bar with send button
- [ ] Mobile responsive layout
- [ ] Build history page
- [ ] Build settings page

### Phase D: Admin & Data Pipeline (2-3 days)
- [ ] Build admin dashboard (metrics cards + charts)
- [ ] Build document management page (sync, ingest URL, delete)
- [ ] Implement document sync endpoint (transactional)
- [ ] Build knowledge base browser page (sources + chunks)
- [ ] Implement rate limiting (Upstash Redis)
- [ ] Set up Langfuse integration
- [ ] Implement cache TTL cleanup (cron via Vercel Cron)

### Phase E: Polish & Deploy (2-3 days)
- [ ] Add Framer Motion page transitions
- [ ] Add micro-animations (message appear, sidebar toggle, button hover)
- [ ] Accessibility audit (keyboard navigation, screen reader, contrast)
- [ ] SEO: meta tags, OG image, sitemap
- [ ] Write E2E tests (Playwright)
- [ ] Set up GitHub Actions CI (lint + test + E2E)
- [ ] Deploy to Vercel
- [ ] Configure Neon PostgreSQL production branch
- [ ] Write README.md
- [ ] Final QA pass

**Total estimated effort: 16-22 days**

---

## 15. Open Questions

> [!IMPORTANT]
> **Q1: Embedding model strategy?**
> Should we use **Option A: HF Inference API** (simpler, adds ~150ms latency per query) or **Option B: Transformers.js** (faster after cold start, but 438MB model in serverless is risky)? I recommend **Option A** for production simplicity.

> [!IMPORTANT]
> **Q2: Fine-tuned model or base BGE?**
> The original uses a fine-tuned BGE model (+21.92% MRR@10). Should the new app also use the fine-tuned model (requires pushing it to HF Hub) or start with base `BAAI/bge-base-en-v1.5` and fine-tune later? I recommend **base model first**, fine-tune in Phase D.

> [!IMPORTANT]
> **Q3: Auth providers?**
> Plan includes GitHub + Google + Email magic link. Do you want different/additional providers (e.g., Discord, Apple ID)?

> [!IMPORTANT]
> **Q4: Deployment target?**
> Plan assumes **Vercel** (free tier). Do you want Docker self-hosted instead? This changes SSE streaming approach and database hosting.

> [!IMPORTANT]
> **Q5: Data migration?**
> Should we seed the new database with the existing 21 scraped documents from Repo-2's `data/` directory, or start fresh with a new ingestion run?

---

*Awaiting approval before writing a single line of code.*
