# Changelog

All notable changes to the Behörden-Bot web app are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning:
[SemVer](https://semver.org/).

## [Unreleased]

### Added

- **Pipeline visualizer (admin):** `admin.testPipeline` runs the full 3-agent ReAct
  pipeline glass-box with `NoopMemory` + `bypassCache`, returns a full trace
  (`maskedQuery`, `guardrail`, research steps, analyst matrix, parent-expanded
  sources). New `/admin/pipeline-tester` page renders a GitHub-Actions-style
  Stage 0→3 timeline: masked query + guardrail verdict, ReAct steps, matched-child
  snippet → expanded-parent context, comparison matrix, and the final markdown answer.
  `Source` now carries optional `childText`/`parentText` so the child→parent
  expansion is visible. Added `adminLongProcedure` (60 s `withTimeout` middleware);
  the tRPC route handler runs on the Node runtime with `maxDuration = 60`.

### Fixed

- **Semantic cache race condition:** replaced findUnique+INSERT two-step write with a
  single atomic `INSERT … ON CONFLICT ("queryHash") DO UPDATE`, eliminating the TOCTOU
  race that could cause a unique-constraint crash under concurrent load.
- **No-op conversation update:** replaced `prisma.conversation.update({ data: {} })` in
  `chat-pipeline.ts` with an explicit `data: { updatedAt: new Date() }` to remove the
  unnecessary SQL write while still bumping the timestamp.
- **BM25 O(doc_length) scoring:** `BM25Okapi` now pre-computes per-document
  term-frequency maps at construction time; `getScore` is now O(query_length) instead
  of O(query_length × doc_length).
- **Semantic cache missing HNSW index:** added pgvector HNSW index on
  `semantic_cache.queryVector` via migration `20260802_add_semantic_cache_hnsw_index`.
  Cosine similarity lookups are now ANN instead of a sequential scan.
- **CSP `script-src unsafe-inline`:** replaced the static `unsafe-inline` in
  `script-src` with a per-request cryptographic nonce generated in `middleware.ts` and
  embedded in the CSP header at response time. `style-src` retains `unsafe-inline`
  (Tailwind CSS v4 requirement, logged in `SECURITY_EXCEPTIONS.md`).
- **Mode toggle hardcoded to agentic:** `modeRef` in `chat-interface.tsx` replaced with
  proper `useState`; `ChatInput` now renders a Standard/Agentic toggle that persists the
  selection across messages in the session.
- **Double user-message persistence:** removed the redundant `chat.sendMessage` tRPC
  mutation call from `useChat.sendMessage`; the SSE pipeline's `findOrCreateUserMessage`
  is the single authoritative write path.
- **Guardrail prompt injection:** guardrail now splits the system instructions and user
  query into separate system/user messages, truncates the query to 500 chars, and wraps
  it in `<user_query>` XML delimiters with an explicit data-vs-instruction notice to
  raise the bar for instruction-override attacks.
- **Vector raw SQL scattered across callers:** created `src/server/db/vector-queries.ts`
  as the single source of truth for all pgvector `$queryRaw`/`$executeRaw` calls.
  `dense.ts` and `semantic-cache.ts` now delegate to `vectorQueries.*` — no inline SQL
  outside this module.
- **`Message.sources` unvalidated at read boundary:** replaced the untyped
  `parseJsonArray` cast in `conversation.ts` with a Zod-validated `parseSourcesJson`
  that enforces the `ChatSource` shape and returns `[]` on malformed data. Added
  explanatory JSDoc documenting the deliberate `Json?` trade-off and when to revisit.
- **`stop()` partial message lost on reload:** added `chat.savePartial` tRPC mutation;
  `stop()` now captures accumulated tokens and persists them as an ASSISTANT message
  with `metadata: { partial: true }` — partial responses survive conversation reload.
- **No retry on stream failure:** `sendMessage` in `use-chat.ts` now retries up to 2
  times with exponential backoff (500 ms → 1 000 ms) for transient 5xx / network
  errors. 4xx errors (auth, validation, rate-limit) are not retried.
- **Ingest no backpressure guard:** added `IngestQueue` (serial async queue, configurable
  concurrency, `drain()` API) and updated `syncAllDocuments` to process one document at
  a time, protecting the HF Inference API from burst-embedding and staying within the
  Vercel 60 s function timeout.
- **`pdf-parse` version unpinned:** changed `"pdf-parse": "^1.1.1"` to exact pin
  `"1.1.1"` in `package.json` to prevent silent upgrades of an unmaintained library.
- **`duck-duck-scrape` tightly coupled:** introduced `WebSearchProvider` interface,
  `DuckDuckGoProvider` wrapper (dynamic import), `ACTIVE_PROVIDER` singleton, and
  `setWebSearchProvider()` for runtime swapping. Migration to Brave Search / Tavily is
  now a one-line change; call sites are unchanged.

### Changed

- **Circuit breaker + rate limiter:** added prominent `⚠️ SERVERLESS LIMITATION`
  comments to `CircuitBreaker` and `RateLimiter` explaining that in-process state does
  not persist across Vercel cold starts. `UPSTASH_REDIS_URL` + `UPSTASH_REDIS_TOKEN`
  must be set in production.
- **`next.config.ts` CSP moved to middleware:** the static `Content-Security-Policy`
  header has been removed from `next.config.ts`; the nonce-bearing CSP is now set
  exclusively by `src/middleware.ts` on each request.

### Added

- CI/CD: GitHub Actions workflows for CI, E2E, security scans (Gitleaks,
  Semgrep, CodeQL, SBOM), and Vercel deploy.
- Husky pre-commit hooks: lint-staged (ESLint + Prettier), TypeScript
  typecheck, and a lightweight secret scan.
- Playwright E2E suite covering landing page, route guards, chat streaming,
  history search, and the admin role guard.
- Project README and this changelog.

### Changed

- `Message` model: added `@@index([role, createdAt])` to speed up the admin
  dashboard's raw-SQL aggregates (`metrics`, `dailyQueries`, `modeSplit`,
  `recentQueries`).

## [0.1.0] - 2026-07-30

### Added

- Phase D foundation: admin dashboard (metrics, daily queries, mode split,
  recent queries), URL ingest pipeline and CLI, cache cleanup cron
  (`/api/cron/cleanup-cache`), Langfuse tracing, health check API, and
  startup documentation.
- Phase C chat UI: streaming chat interface, tRPC routers (conversation, chat,
  sources, admin), SSE endpoint (`POST /api/chat/stream`), disambiguation
  cards, pipeline status indicators, and semantic cache integration.
- Phase A/B foundation: Auth.js v5 (GitHub, Google, Resend magic link), Prisma
  - PostgreSQL schema with pgvector, protected routes, settings, sources, and
    history pages.
- Test infrastructure: Vitest unit + integration suites with mock Prisma,
  coverage thresholds (≥80%).

[0.1.0]: https://github.com/anomalyco/behoerden-bot
