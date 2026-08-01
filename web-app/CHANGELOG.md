# Changelog

All notable changes to the Behörden-Bot web app are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning:
[SemVer](https://semver.org/).

## [Unreleased]

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
