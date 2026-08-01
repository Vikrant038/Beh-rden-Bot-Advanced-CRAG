# Behörden-Bot Web — Complete Startup & Verification Guide

**Branch:** `web-app` | **Directory:** `Repo-2/web-app/`  
**Total Files:** 143 | **Phases Implemented:** A + B + C  
**Date:** 2026-08-01

---

## Current State Summary

| Phase | What's Built | Files |
|-------|-------------|-------|
| **Phase A** (Foundation) | Next.js 15, TypeScript strict, Prisma + pgvector, NextAuth v5, tRPC v11, security (rate limit, SSRF, CSP headers), env validation, error handling, Pino logger | 40 files |
| **Phase B** (RAG Engine) | LLM client (Groq + HF), embeddings (BGE 768d), PII masker, BM25 + dense + RRF + reranker, CRAG gate, disambiguation, guardrail, query expansion, semantic cache, summary-buffer memory, 3-agent orchestrator, visa calculator, web search | 44 files |
| **Phase C** (Chat UI + API) | 5 tRPC routers, SSE streaming endpoint, `useChat` hook, chat components (messages, input, pipeline status, disambiguation cards, source citations, streaming text, markdown), sidebar, history page, settings page, login page, landing page | 59 files |

---

## Step 1: Environment Setup

```bash
# 1.1 — Navigate to the web-app directory
cd /Users/vikranty/Documents/Project/OLD\ Lap\ Work/Repo-2

# 1.2 — Confirm you are on the web-app branch
git branch --show-current
# Expected: web-app

# 1.3 — Pull latest changes
git pull origin web-app

# 1.4 — Navigate into the web-app directory
cd web-app

# 1.5 — Copy .env.example to .env and fill in your keys
cp .env.example .env
```

**Edit `.env` with your actual values:**

| Variable | Required | Where to Get It |
|----------|----------|-----------------|
| `DATABASE_URL` | ✅ Yes (for DB features) | [Neon](https://neon.tech) free tier or local Postgres |
| `NEXTAUTH_SECRET` | ✅ Yes | Run: `openssl rand -base64 32` |
| `NEXTAUTH_URL` | ✅ Yes | `http://localhost:3000` |
| `GROQ_API_KEY` | ✅ Yes (for RAG) | [Groq Console](https://console.groq.com) |
| `HF_TOKEN` | ✅ Yes (for embeddings) | [Hugging Face](https://huggingface.co/settings/tokens) |
| `GITHUB_CLIENT_ID/SECRET` | Optional | GitHub OAuth App |
| `GOOGLE_CLIENT_ID/SECRET` | Optional | Google Cloud Console |
| `UPSTASH_REDIS_URL/TOKEN` | Optional | [Upstash](https://upstash.com) (falls back to in-memory) |

> **Without a database:** The app will still build and typecheck. Tests use mocked Prisma. The dev server will show the UI but chat features require a live Postgres + pgvector.

---

## Step 2: Install Dependencies

```bash
# 2.1 — Install pnpm if not available
npm install -g pnpm

# 2.2 — Install all dependencies
pnpm install

# 2.3 — Generate the Prisma client
pnpm db:generate
```

**Expected output for db:generate:**
```
✔ Generated Prisma Client to ./node_modules/@prisma/client in XXms
```

---

## Step 3: Run All Quality Gates (6 checks)

Run these one by one and verify each passes:

```bash
# 3.1 — TypeScript strict typecheck (zero errors expected)
pnpm typecheck

# 3.2 — ESLint (zero errors, zero warnings expected)
pnpm lint

# 3.3 — Prettier format check
pnpm format:check

# 3.4 — Production build
pnpm build

# 3.5 — Unit + Integration + Component tests (164 tests, 27 files)
pnpm test

# 3.6 — Tests with coverage (80% threshold on lines/functions/statements)
pnpm vitest run --coverage
```

**Expected results:**

| Gate | Command | Expected |
|------|---------|----------|
| Typecheck | `pnpm typecheck` | `0 errors` |
| Lint | `pnpm lint` | `0 errors, 0 warnings` |
| Format | `pnpm format:check` | All files formatted |
| Build | `pnpm build` | `✓ Compiled successfully` |
| Tests | `pnpm test` | `164 tests passed, 27 test files` |
| Coverage | `pnpm vitest run --coverage` | `lines ≥80%, functions ≥80%, statements ≥80%` |

---

## Step 4: Start the Dev Server

```bash
# 4.1 — Start Next.js dev server with Turbopack
pnpm dev

# Expected output:
# ▲ Next.js 15.x.x (Turbopack)
# - Local: http://localhost:3000
```

---

## Step 5: Manual UI Verification Checklist

Open http://localhost:3000 in your browser and verify:

### 5.1 Landing Page (`/`)
- [ ] Hero section with hero banner image loads
- [ ] Pipeline visualization (Research → Analyst → Writer) visible
- [ ] Feature grid with glassmorphism cards
- [ ] Tech stack badges displayed
- [ ] "Start Chatting" CTA button works → navigates to `/login` or `/chat`

### 5.2 Login Page (`/login`)
- [ ] Page renders with auth provider buttons
- [ ] GitHub / Google OAuth buttons visible (if configured)
- [ ] Email magic link input visible (if Resend configured)

### 5.3 Chat Page (`/chat`) — requires auth
- [ ] Sidebar loads with conversation list
- [ ] New conversation can be created
- [ ] Chat input accepts text and submits on Enter
- [ ] Pipeline status bar shows stages (Disambiguation → Guardrail → Retrieval → Generation)
- [ ] Messages render with markdown formatting
- [ ] Source citations collapsible with relevance scores
- [ ] Disambiguation cards appear for vague queries (try: "When I move to Germany...")
- [ ] Streaming text animation works (words appear progressively)

### 5.4 Chat with ID (`/chat/[id]`)
- [ ] Clicking a conversation in sidebar loads its messages
- [ ] Conversation title auto-generates after first exchange

### 5.5 History Page (`/history`)
- [ ] Lists all past conversations
- [ ] Search functionality works
- [ ] Infinite scroll loads more conversations
- [ ] Markdown export download works
- [ ] Delete conversation works

### 5.6 Settings Page (`/settings`)
- [ ] Page loads for authenticated users
- [ ] User info displayed

### 5.7 Health Endpoint
- [ ] Open http://localhost:3000/api/health
- [ ] Returns JSON with `database` and `cache` status

---

## Step 6: Database Setup (For Full Chat Testing)

If you want to test the full RAG pipeline with a live database:

```bash
# 6.1 — Start local Postgres with pgvector (from Repo-2 root)
cd /Users/vikranty/Documents/Project/OLD\ Lap\ Work/Repo-2
docker-compose up -d postgres

# 6.2 — Run Prisma migrations (from web-app directory)
cd web-app
pnpm db:migrate

# 6.3 — (Optional) Seed data
pnpm db:seed
```

Or use **Neon** (free cloud Postgres with pgvector):
1. Create a free project at [neon.tech](https://neon.tech)
2. Enable the `vector` extension: `CREATE EXTENSION IF NOT EXISTS vector;`
3. Copy the connection string to `DATABASE_URL` in `.env`
4. Run `pnpm db:deploy`

---

## Step 7: Push Docs to GitHub

Once you've verified everything:

```bash
# 7.1 — Navigate to repo root
cd /Users/vikranty/Documents/Project/OLD\ Lap\ Work/Repo-2

# 7.2 — Verify you are on web-app branch
git branch --show-current

# 7.3 — Check status
git status

# 7.4 — Add, commit, push
git add .
git commit -m "docs: add startup guide and verification checklist"
git push origin web-app
```

---

## File Structure Reference (143 files)

```
web-app/
├── .env.example                          # Environment template
├── .gitignore / .prettierrc              # Git + formatting config
├── package.json                          # Dependencies & scripts
├── tsconfig.json                         # Strict TypeScript
├── next.config.ts                        # Security headers + CSP
├── vitest.config.mts                     # Test config (80% coverage)
├── playwright.config.ts                  # E2E test config
│
├── prisma/
│   ├── schema.prisma                     # 8 models + pgvector
│   └── migrations/                       # DDL + HNSW indices
│
├── docs/
│   ├── ROADMAP.md                        # Atomic task breakdown
│   ├── TEST_DESIGN.md                    # TDD coverage plan
│   ├── security/SECURITY_EXCEPTIONS.md   # CSRF exception ledger
│   └── status/
│       ├── phase-a-foundation.md         # Phase A complete ✅
│       ├── phase-b-foundation.md         # Phase B complete ✅
│       └── phase-c-chat-ui.md            # Phase C complete ✅
│
├── src/
│   ├── app/
│   │   ├── layout.tsx                    # Root layout + fonts
│   │   ├── page.tsx                      # Landing page
│   │   ├── globals.css                   # Design system tokens
│   │   ├── login/page.tsx                # Auth page
│   │   ├── chat/page.tsx                 # New chat
│   │   ├── chat/[id]/page.tsx            # Chat by ID
│   │   ├── chat/layout.tsx               # Chat layout + sidebar
│   │   ├── history/page.tsx              # History
│   │   ├── settings/page.tsx             # Settings
│   │   └── api/
│   │       ├── auth/[...nextauth]/       # NextAuth handler
│   │       ├── chat/stream/route.ts      # SSE streaming endpoint
│   │       ├── health/route.ts           # Deep health check
│   │       └── trpc/[trpc]/route.ts      # tRPC handler
│   │
│   ├── components/
│   │   ├── chat/
│   │   │   ├── chat-interface.tsx        # Main chat container
│   │   │   ├── chat-input.tsx            # Message input
│   │   │   ├── chat-layout.tsx           # Desktop/mobile layout
│   │   │   ├── message-bubble.tsx        # Message rendering
│   │   │   ├── streaming-text.tsx        # Token-by-token display
│   │   │   ├── pipeline-status.tsx       # RAG stage indicator
│   │   │   ├── disambiguation-cards.tsx  # Clarifying options
│   │   │   ├── source-citation.tsx       # Collapsible sources
│   │   │   └── markdown.tsx              # Markdown renderer
│   │   ├── sidebar/
│   │   │   ├── app-sidebar.tsx           # Main sidebar
│   │   │   └── conversation-item.tsx     # Conversation entry
│   │   └── history/
│   │       └── history-list.tsx          # History with search
│   │
│   ├── hooks/
│   │   └── use-chat.ts                   # SSE chat hook
│   │
│   ├── lib/
│   │   ├── utils.ts                      # cn(), formatDate
│   │   ├── chat/types.ts                 # Chat type definitions
│   │   └── trpc/
│   │       ├── client.ts                 # tRPC client
│   │       └── provider.tsx              # React Query provider
│   │
│   ├── server/
│   │   ├── auth.ts                       # NextAuth + Prisma adapter
│   │   ├── db.ts                         # Prisma singleton
│   │   ├── env.ts                        # Zod env validation
│   │   ├── embeddings/client.ts          # HF BGE 768d client
│   │   ├── pii/masker.ts                 # PII regex redaction
│   │   ├── llm/
│   │   │   ├── client.ts                 # Groq + HF dual LLM
│   │   │   ├── circuit-breaker.ts        # Failover management
│   │   │   ├── errors.ts                 # LLM error types
│   │   │   └── json.ts                   # JSON extraction
│   │   ├── rag/
│   │   │   ├── types.ts                  # RAG constants + types
│   │   │   ├── pipeline.ts               # Standard CRAG pipeline
│   │   │   ├── chat-pipeline.ts          # SSE chat orchestrator
│   │   │   ├── instance.ts               # Singleton pipeline
│   │   │   ├── disambiguation.ts         # Stage 0B
│   │   │   ├── guardrail.ts              # Stage 0A
│   │   │   ├── crag-gate.ts              # CRAG threshold gate
│   │   │   ├── query-expansion.ts        # Sub-query generation
│   │   │   ├── retrieval/                # Dense + BM25 + RRF + Reranker
│   │   │   ├── cache/semantic-cache.ts   # Multi-tier cache
│   │   │   ├── memory/summary-buffer.ts  # Conversation memory
│   │   │   ├── agents/                   # Research + Analyst + Orchestrator
│   │   │   └── tools/                    # Visa calc + Web search
│   │   ├── routers/
│   │   │   ├── chat.ts                   # Chat mutations
│   │   │   ├── conversation.ts           # CRUD + export
│   │   │   ├── source.ts                 # Source management
│   │   │   ├── document.ts               # Document ops (Phase D)
│   │   │   └── admin.ts                  # Admin metrics
│   │   ├── trpc/
│   │   │   ├── t.ts                      # tRPC instance
│   │   │   ├── context.ts                # Request context
│   │   │   └── router.ts                 # App router
│   │   └── lib/
│   │       ├── errors/                   # Domain error system
│   │       ├── logger.ts                 # Pino + redaction
│   │       ├── response.ts              # API envelope
│   │       └── security/                 # Rate limiter + SSRF
│   │
│   └── types/
│       ├── next-auth.d.ts                # Session augmentation
│       └── vitest-globals.d.ts           # Test globals
│
└── tests/
    ├── setup.ts                          # dotenv loader
    ├── helpers/mock-prisma.ts            # Mock Prisma type
    ├── unit/ (19 test files)             # Unit tests
    └── integration/ (4 test files)       # Integration tests
```

---

## Quick Reference — All Commands

```bash
# ── Setup ──
pnpm install                    # Install dependencies
pnpm db:generate                # Generate Prisma client

# ── Quality Gates ──
pnpm typecheck                  # TypeScript strict check
pnpm lint                       # ESLint
pnpm format:check               # Prettier check
pnpm build                      # Production build
pnpm test                       # Run all 164 tests
pnpm vitest run --coverage      # Coverage report (80% threshold)

# ── Development ──
pnpm dev                        # Dev server (http://localhost:3000)

# ── Database ──
pnpm db:migrate                 # Run Prisma migrations (local dev)
pnpm db:deploy                  # Deploy migrations (production)
pnpm db:seed                    # Seed data

# ── Formatting ──
pnpm format                     # Auto-format all files
```
