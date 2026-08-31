# Behörden-Bot (Web App)

AI assistant for German immigration, student visas, APS certification, blocked
accounts, and university applications. A Next.js 15 (App Router) frontend backed
by the [Repo-2](https://github.com/Vikrant038/Beh-rden-Bot-Advanced-CRAG) 3-Agent ReAct RAG
pipeline.

## Stack

- **Framework:** Next.js 15 (App Router), React 19, TypeScript 5
- **UI:** Tailwind CSS 4, framer-motion, lucide-react, recharts, next-themes, Scroll Cinematic Hero
- **Media & CDN:** Cloudinary CDN asset streaming (`SCROLL_ASSETS_URL`), HTTP 206 Range video streaming
- **Data:** Prisma 6 + PostgreSQL (pgvector), tRPC 11 + TanStack Query
- **Auth:** Auth.js v5 (GitHub, Google, Resend magic link; JWT sessions)
- **AI/LLM:** SSE streaming chat, 3-agent ReAct pipeline, hybrid retrieval (pgvector + FTS)
- **Observability:** Langfuse tracing, pino logging
- **Quality:** Vitest (unit + integration, ≥85% coverage floor across all 4 metrics, 898 tests),
  Playwright E2E, ESLint, Prettier, Husky pre-commit hooks, GitHub Actions CI

## Getting started

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment (copy template, fill in secrets)
cp .env.example .env

# 3. Start local Postgres with pgvector (web-app/docker-compose.yml)
docker compose up -d postgres

# 4. Generate the Prisma client and apply migrations.
#    Migrations run as the behoerden_migrator (DDL) role — the app runtime
#    role (behoerden_app) is DML-only by design (PoLP).
pnpm prisma generate
DATABASE_URL="postgresql://behoerden_migrator:behoerden_password@localhost:5432/behoerden_bot" \
  pnpm prisma migrate deploy

# 5. Run the dev server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

> `.env` is gitignored. Never commit real secrets — the pre-commit hook scans
> staged files for credential patterns and CI runs Gitleaks.

### Local database (Docker)

`web-app/docker-compose.yml` boots `pgvector/pgvector:pg16` (same image CI
uses) and, on a fresh volume, runs `docker/postgres-init.sql`, which
provisions the principle-of-least-privilege roles documented in `.env.example`
(GUARDRAILS M1.2):

- `behoerden_migrator` — DDL role: owns the database, runs Prisma migrations,
  and can create the `migrate dev` shadow database (`CREATEDB`).
- `behoerden_app` — DML-only app runtime role; `ALTER DEFAULT PRIVILEGES`
  grants make tables/sequences created by the migrator automatically usable.

The `vector` extension is pre-created by the init script, so the migrator never
needs superuser. **Do not** add `sslmode=require` to `localhost` URLs — local
Postgres has TLS disabled; `sslmode=require` belongs only on cloud (Neon) URLs
(see the commented examples in `.env.example`). If you previously used the
repo-root compose (Python app, `ankane/pgvector`), drop its stale volume
first: `docker compose down -v && docker compose up -d postgres`.

## Scripts

| Script                               | Description                                         |
| ------------------------------------ | --------------------------------------------------- |
| `pnpm dev`                           | Start the dev server (port 3000)                    |
| `pnpm build`                         | Production build                                    |
| `pnpm start`                         | Serve the production build                          |
| `pnpm lint`                          | ESLint (Next config)                                |
| `pnpm typecheck`                     | `tsc --noEmit`                                      |
| `pnpm test`                          | Vitest unit + integration suite                     |
| `pnpm test:watch`                    | Vitest watch mode                                   |
| `pnpm vitest run --coverage`         | Vitest coverage gate (≥85% across all 4 metrics)     |
| `pnpm test:e2e`                      | Playwright E2E suite                                |
| `pnpm format` / `pnpm format:check`  | Prettier write / check                              |
| `pnpm db:migrate` / `pnpm db:deploy` | Prisma migrate dev / deploy                         |
| `pnpm db:seed`                       | Seed the database                                   |
| `pnpm ingest`                        | Run the document ingest CLI                         |

### Quality gate (must pass before merge)

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test
pnpm exec vitest run --coverage   # ≥85% statements/branches/functions/lines (898 tests)
pnpm build
pnpm test:e2e                     # requires Playwright browsers
```

**Latest full-corpus CRAG eval** (`scripts/eval-crag-webapp.ts`, 30 multilingual questions + adversarial traps, English-first corpus): all six gates pass — context recall **79.1%** (threshold 70%), context precision 100%, faithfulness 4.02/5.0, answer relevance 4.60/5.0 (BGE-M3 cos 0.724), traps 2/2. See [`docs/EVALUATION.md`](docs/EVALUATION.md).

## Project structure

```
src/
├── app/              # App Router pages, API routes (chat stream, trpc, auth, cron)
├── components/       # UI components (chat, admin, history, sources)
├── hooks/            # Client hooks (use-chat, theme, …)
├── lib/              # Shared client libraries (chat types, tRPC client)
├── server/           # Server code (trpc routers, rag pipeline, auth, db, env)
└── styles/           # Global CSS
prisma/               # Schema + migrations
tests/
├── unit/             # Vitest unit tests
├── integration/      # Vitest integration tests
├── e2e/              # Playwright E2E specs + helpers
└── helpers/          # Shared test fixtures (mock-prisma, …)
scripts/              # Developer tooling (secret scan, …)
```

## Key flows

- **Chat** — `POST /api/chat/stream` (SSE) drives the streaming UI. User messages are
  persisted by `findOrCreateUserMessage` inside the pipeline (single write path). Vague
  queries surface Stage-0 disambiguation cards. Stopped streams are persisted as partial
  ASSISTANT messages via `chat.savePartial`. Transient stream failures are retried up to
  2 times with exponential backoff.
- **Admin** — `/admin/*` is restricted to the `ADMIN` role; the dashboard shows
  usage metrics, cache health, mode split, and recent queries (raw SQL against
  `messages`/`conversations`).
- **Ingest** — `pnpm ingest` runs the URL/PDF ingestion pipeline via a serial
  `IngestQueue` (one document at a time). A nightly cron (`/api/cron/cleanup-cache`)
  clears the semantic cache.

## Cost & query economics

Every LLM call is metered end-to-end. `LlmUsageCollector` (AsyncLocalStorage)
records **provider, model, prompt tokens, completion tokens, and estimated USD**
for every call; the agentic pipeline rolls those up into per-agent costs
(`research` / `analyst` / `writer`) and a `totalCostUsd`, and both pipeline
variants expose the raw call records (`llmCalls`) in their glass-box trace —
visible in the admin pipeline tester. Embeddings and reranking run on a
self-hosted HF Inference worker (inference credits, not per-token billing), so
the per-query cost is dominated by generation.

### Providers & pricing basis

| Component       | Provider                 | Model / endpoint                                                       | Basis                                                             |
| --------------- | ------------------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Generation      | Groq                     | `openai/gpt-oss-120b` (primary), Qwen/GPT OSS/Kimi fallbacks | $0.15/1M in · $0.60/1M out |
| Query expansion | Groq                     | same model                                                             | counted per call above                                            |
| Embeddings      | HF worker (self-hosted)  | `BAAI/bge-m3`, batched                                                 | inference credits, no per-token charge                            |
| Rerank          | HF endpoint              | cross-encoder                                                          | inference credits, no per-token charge                            |
| Semantic cache  | Postgres pgvector (HNSW) | —                                                                      | $0 after the first cold run                                       |

### Typical per-query cost

Estimates at current token budgets (system prompt + context chunks + memory
for input; 400–600 token answers):

| Pipeline           | LLM calls                                    | Typical input tokens   | Typical output tokens | Est. cost / query   |
| ------------------ | -------------------------------------------- | ---------------------- | --------------------- | ------------------- |
| **Standard CRAG**  | 2 (expansion + generation)                   | ~2,000–3,000           | ~500                  | **~$0.0002**        |
| **Agentic**        | 5–7 (research iterations + analyst + writer) | ~5,000–8,000           | ~1,200                | **~$0.0006–0.0010** |
| Cache hit (either) | 0                                            | — (1 embedding lookup) | —                     | **~$0.00001**       |

At ~1,000 queries/day with a ~40% cache-hit rate, the blended cost lands well
under **$1/day** on the 8b model — the cache is the dominant lever, which is
why the admin dashboard tracks hit rate and the cache health gauge.

### Cost-optimization measures (implemented)

1. **Semantic cache (7-day TTL)** — exact-hash tier + vector-similarity tier;
   a hit skips the entire pipeline, including the LLM.
2. **One expansion call, not many** — bilingual `2+2` EN/DE sub-queries come
   from a single structured-JSON LLM call, so query decomposition never
   multiplies provider spend.
3. **Batched embeddings** — all sub-queries embed in **one** worker request
   (`embedTexts`), and the dense pgvector lookups run in parallel; no
   per-sub-query round-trips.
4. **Never cache ungrounded output (M1)** — fallback/error answers are not
   persisted, so a transient failure can't poison the cache with a cheap wrong
   answer that users then "save" for 7 days.
5. **ANN indexes** — HNSW on chunk embeddings and cache vectors means no
   sequential scans during retrieval or cache lookup.
6. **Embedding cache + worker self-warm** — exact-text batch cache (1h TTL)
   and a 5-minute warm cron avoid cold-start model loads that otherwise burn
   a full round-trip (and its compute) on the first query.
7. **Token discipline** — 500-char guardrail query truncation, `maxTokens`
   caps on generation, and a shared system prompt keep every call lean.
8. **Bounded run history** — pipeline-tester traces are pruned to the newest
   10 runs, so diagnostic storage doesn't grow unbounded.

## Environment variables

See `.env.example` for the full list with comments. Key ones:

| Variable                 | Required        | Purpose                                                                                                |
| ------------------------ | --------------- | ------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`           | Yes             | App runtime (DML) connection — `behoerden_app` locally, Neon pooled URL in prod                        |
| `MIGRATION_DATABASE_URL` | Migrations only | DDL role (`behoerden_migrator`) — used to apply Prisma migrations                                      |
| `NEXTAUTH_SECRET`        | Yes             | Signs Auth.js session JWTs                                                                             |
| `NEXTAUTH_URL`           | No (dev)        | Canonical app URL                                                                                      |
| `GROQ_API_KEY`           | No*             | Primary LLM provider                                                                                   |
| `HF_TOKEN`               | No*             | Fallback LLM provider + embeddings                                                                     |
| `CRON_SECRET`            | No*             | Bearer guard for cron endpoints                                                                        |
| `UPSTASH_REDIS_URL`      | **Yes (prod)**  | Upstash Redis URL for cross-instance rate limiting; in-memory fallback is per-serverless-instance only |
| `UPSTASH_REDIS_TOKEN`    | **Yes (prod)**  | Upstash Redis token                                                                                    |
| `LANGFUSE_*`             | No              | LLM tracing                                                                                            |

\* Required at runtime for LLM features; CI uses placeholders.

## Known limitations

### Serverless state (circuit breaker & rate limiter)

`CircuitBreaker` and `RateLimiter` store state in-process. On Vercel each cold
start resets the failure counter and rate-limit buckets, so these guards only
protect within a single warm function instance. For production deployments,
`UPSTASH_REDIS_URL` + `UPSTASH_REDIS_TOKEN` **must** be set — without them, rate
limits are per-instance and the circuit breaker provides no cross-request
protection.

### Web search fallback

The CRAG web fallback and Research Agent tool use `duck-duck-scrape` via the
`DuckDuckGoProvider` adapter. It is an unofficial scraper and may break without
notice if DDG changes its HTML. To migrate to a stable API, implement
`WebSearchProvider` and call `setWebSearchProvider(new YourProvider())` — no
other changes needed. Tracked in `docs/ROADMAP.md`.

### Guardrail prompt injection

The domain guardrail uses an instruction-following LLM (not a dedicated
classifier). The query is truncated, XML-delimited, and placed in a separate
user message to raise the bar for injection attacks, but a crafted prompt can
still manipulate the YES/NO verdict. A fine-tuned text-classification model
would be more robust. See `docs/security/SECURITY_EXCEPTIONS.md`.

### Ingest pipeline backpressure

`syncAllDocuments` and individual `ingestUrl` calls run synchronously inside the
serverless function. For large corpora (>~20 documents) this risks hitting the
60 s Vercel timeout. The interim fix is `IngestQueue` (serial, one document at a
time). For production-scale ingestion, migrate to a background queue (Vercel
Cron + a `ingest_jobs` DB table, or Upstash BullMQ).

### Message sources schema

`Message.sources` is stored as a `Json?` blob. Sources are Zod-validated at the
read boundary in `conversation.ts`, but SQL-level analytics (e.g. "which
documents were cited most") are not possible without a normalised relation.
Revisit when that use-case is needed.

## CI/CD

GitHub Actions (`.github/workflows/`) runs on the `main`/`web-app` branches for
`web-app/**` paths:

- `ci-web-app.yml` — format, lint, typecheck, unit/integration tests, coverage,
  and production build.
- `e2e-web-app.yml` — boots PostgreSQL (pgvector service), applies migrations,
  installs Playwright browsers, runs the E2E suite.
- `security-web-app.yml` — Gitleaks (secrets), Semgrep + CodeQL (SAST), and SBOM.
- `deploy-web-app.yml` — deploys to Vercel (`--prod`).

Local pre-commit hooks (Husky) run lint-staged (ESLint + Prettier), `tsc`, and
a lightweight secret scan. Full secret/SBOM/SAST audits run in CI.

## Deploy

The app is built for **Vercel + Neon PostgreSQL**. Configure the
`VERCEL_TOKEN` / `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` secrets in the repo and
push to `web-app` (or `main`); `deploy-web-app.yml` handles the rest. Set all
non-secret variables in the Vercel project and mark the secrets.

## Documentation

### 📚 For Developers

- **`docs/ARCHITECTURE.md`** — Complete system design, folder structure, data flow, design patterns
- **`docs/DEVELOPER_QUICKSTART.md`** — Quick reference for common tasks (start here!)
- **`docs/OPTIMIZATION_GUIDE.md`** — Database optimization, async patterns, performance targets
- **`docs/STARTUP.md`** — Local development setup walkthrough
- **`docs/security/SECURITY_EXCEPTIONS.md`** — Known security limitations & mitigations
- **`docs/status/`** — Phase delivery reports & milestones
- **`CHANGELOG.md`** — Release history
