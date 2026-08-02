# Behörden-Bot (Web App)

AI assistant for German immigration, student visas, APS certification, blocked
accounts, and university applications. A Next.js 15 (App Router) frontend backed
by the [Repo-2](https://github.com/anomalyco/behoerden-bot) 3-Agent ReAct RAG
pipeline.

## Stack

- **Framework:** Next.js 15 (App Router), React 19, TypeScript 5
- **UI:** Tailwind CSS 4, framer-motion, lucide-react, recharts, next-themes
- **Data:** Prisma 6 + PostgreSQL (pgvector), tRPC 11 + TanStack Query
- **Auth:** Auth.js v5 (GitHub, Google, Resend magic link; JWT sessions)
- **AI/LLM:** SSE streaming chat, 3-agent ReAct pipeline, hybrid retrieval
- **Observability:** Langfuse tracing, pino logging
- **Quality:** Vitest (unit + integration, ≥80% coverage), Playwright E2E,
  ESLint, Prettier, Husky pre-commit hooks, GitHub Actions CI

## Getting started

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment (copy template, fill in secrets)
cp .env.example .env

# 3. Generate the Prisma client and apply migrations
pnpm prisma generate
pnpm prisma migrate deploy

# 4. Run the dev server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

> `.env` is gitignored. Never commit real secrets — the pre-commit hook scans
> staged files for credential patterns and CI runs Gitleaks.

## Scripts

| Script                               | Description                      |
| ------------------------------------ | -------------------------------- |
| `pnpm dev`                           | Start the dev server (port 3000) |
| `pnpm build`                         | Production build                 |
| `pnpm start`                         | Serve the production build       |
| `pnpm lint`                          | ESLint (Next config)             |
| `pnpm typecheck`                     | `tsc --noEmit`                   |
| `pnpm test`                          | Vitest unit + integration suite  |
| `pnpm test:watch`                    | Vitest watch mode                |
| `pnpm test:e2e`                      | Playwright E2E suite             |
| `pnpm format` / `pnpm format:check`  | Prettier write / check           |
| `pnpm db:migrate` / `pnpm db:deploy` | Prisma migrate dev / deploy      |
| `pnpm db:seed`                       | Seed the database                |
| `pnpm ingest`                        | Run the document ingest CLI      |

### Quality gate (must pass before merge)

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test
pnpm exec vitest run --coverage   # ≥80% lines/functions/statements
pnpm build
pnpm test:e2e                     # requires Playwright browsers
```

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

## Environment variables

See `.env.example` for the full list with comments. Key ones:

| Variable          | Required | Purpose                                 |
| ----------------- | -------- | --------------------------------------- |
| `DATABASE_URL`    | Yes      | PostgreSQL (pgvector) connection string |
| `NEXTAUTH_SECRET` | Yes      | Signs Auth.js session JWTs              |
| `NEXTAUTH_URL`    | No (dev) | Canonical app URL                       |
| `GROQ_API_KEY`    | No*      | Primary LLM provider                    |
| `HF_TOKEN`        | No*      | Fallback LLM provider + embeddings      |
| `CRON_SECRET`     | No*      | Bearer guard for cron endpoints         |
| `UPSTASH_REDIS_URL` | **Yes (prod)** | Upstash Redis URL for cross-instance rate limiting; in-memory fallback is per-serverless-instance only |
| `UPSTASH_REDIS_TOKEN` | **Yes (prod)** | Upstash Redis token |
| `LANGFUSE_*`      | No       | LLM tracing                             |

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

- `docs/STARTUP.md` — local startup walkthrough
- `docs/status/` — phase delivery reports
- `CHANGELOG.md` — release history
