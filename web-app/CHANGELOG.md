# Changelog

All notable changes to the Behörden-Bot web app are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning:
[SemVer](https://semver.org/).

## [Unreleased]

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
  The cosine similarity lookup is now approximate-nearest-neighbour instead of a
  sequential scan.
- **CSP `unsafe-inline`:** replaced static `unsafe-inline` in `script-src` with a
  per-request nonce injected via `middleware.ts`. Style-src retains `unsafe-inline`
  (required by Tailwind's inline critical CSS) with a documented exception.
- **Mode toggle hardcoded to agentic:** `modeRef` in `chat-interface.tsx` replaced with
  proper `useState`; `ChatInput` now renders a Standard/Agentic toggle that persists the
  selection across messages.
- **Double user-message persistence:** removed the redundant `chat.sendMessage` tRPC
  mutation call from `useChat.sendMessage`; the SSE pipeline's `findOrCreateUserMessage`
  is the single authoritative write path.

### Changed

- **Circuit breaker + rate limiter:** added prominent `⚠️ SERVERLESS LIMITATION` doc
  comments to `CircuitBreaker` and `RateLimiter` classes explaining that in-process state
  does not persist across Vercel cold starts. Upstash Redis must be configured in
  production.

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
