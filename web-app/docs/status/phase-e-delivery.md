# Phase E — CI/CD, Husky Hooks, Playwright E2E, Docs & Deploy

**Status:** COMPLETE (pending user verification)
**Date:** 2026-08-01
**Branch:** `web-app`
**Scope:** ROADMAP TASK-040..044 + Message-table performance fix

## Summary

Phase E closes out the web-app roadmap: four GitHub Actions workflows (lint/test/coverage/build, security scans, Playwright E2E, Vercel deploy), a Husky/lint-staged/secret-scan pre-commit gate, a 12-test Playwright E2E suite (all green, running against mocked tRPC/SSE + forged Auth.js session cookies), full README/CHANGELOG documentation, and a Message-table composite index fix shipped as a manual migration. The E2E suite runs headless chromium without any local Postgres or external LLM provider.

## Tasks Delivered

| Task     | Deliverable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Status |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| TASK-040 | CI/CD: `.github/workflows/ci-web-app.yml` (format/lint/typecheck/test/coverage/build, `paths: web-app/**`, pnpm cache, placeholder env), `.github/workflows/security-web-app.yml` (gitleaks v2, Semgrep, CodeQL TS with `.github/codeql/codeql-config.yml`, Anchore SBOM), `.github/workflows/e2e-web-app.yml` (pgvector service container, `prisma migrate deploy`, `playwright install --with-deps`, report upload), `.github/workflows/deploy-web-app.yml` (amondnet/vercel-action@v20, `--prod`, `VERCEL_TOKEN/ORG_ID/PROJECT_ID` secrets)                             | Done   |
| TASK-041 | Husky: `husky@9.1.7` + `lint-staged@17.3.0`, `prepare: "husky"`, `.husky/pre-commit` (lint-staged → `pnpm typecheck` → `node scripts/scan-secrets.mjs`), `.lintstagedrc.mjs` (ESLint+Prettier for ts/tsx, Prettier for css/md/json/mjs), `scripts/scan-secrets.mjs` (staged-diff scan for API keys/private keys, skips lockfiles/docs)                                                                                                                                                                                                                                     | Done   |
| TASK-042 | Playwright E2E: `playwright.config.ts` (dotenv, `NEXTAUTH_SECRET` fallback, sanitized webServer env); `tests/e2e/helpers/auth.ts` (forged Auth.js JWT session cookie via `@auth/core/jwt` encode — no OAuth provider needed), `tests/e2e/helpers/trpc-mock.ts` (single + batch tRPC route mocking on the exact v11 wire format, SSE stream mock); specs `landing` (4), `chat` (3, incl. streamed reply + error banner), `history` (2), `admin` (2) = **12 tests**; `scripts/debug-e2e.mjs` kept as a dev utility (request/pageerror inspector, needs a running dev server) | Done   |
| TASK-043 | Docs: `README.md` rewritten (stack, setup, scripts, quality gate, structure, env table, CI/CD, deploy); `CHANGELOG.md` created (0.1.0 = Phases A–D, Unreleased = Phase E)                                                                                                                                                                                                                                                                                                                                                                                                  | Done   |
| TASK-044 | Deploy: Vercel + Neon configured in `vercel.json`/docs; existing cache-cleanup cron retained; deploy workflow targets Vercel `--prod` on push to `main`                                                                                                                                                                                                                                                                                                                                                                                                                    | Done   |
| Perf fix | Message-table query perf: `prisma/schema.prisma` Message gains `@@index([role, createdAt])`; manual migration `prisma/migrations/20260801_add_message_role_createdAt_idx/migration.sql` (created because no local Postgres to run `migrate dev`); `pnpm prisma validate` PASS                                                                                                                                                                                                                                                                                              | Done   |

## Quality Gates

| Gate                                 | Command                      | Result                                                              |
| ------------------------------------ | ---------------------------- | ------------------------------------------------------------------- |
| E2E                                  | `pnpm test:e2e`              | PASS (12/12, ~46s)                                                  |
| Typecheck                            | `pnpm typecheck`             | PASS                                                                |
| Lint                                 | `pnpm lint`                  | PASS (0 errors, 1 warning)                                          |
| Build                                | `pnpm build`                 | PASS                                                                |
| Format                               | `pnpm format:check`          | PASS                                                                |
| Unit + integration + component tests | `pnpm test`                  | PASS (227 tests, 36 files)                                          |
| Coverage                             | `pnpm vitest run --coverage` | PASS (statements 85.94%, functions 87.18%, lines 86.21% — all ≥ 80) |
| Prisma schema                        | `pnpm prisma validate`       | PASS                                                                |

## Decisions & Exceptions

- **Husky root:** `.git` lives at the repo root (`/workspace`), not in `web-app/`, so husky was installed with an explicit dir arg (`node web-app/node_modules/husky/bin.js web-app/.husky`) and `core.hooksPath = web-app/.husky/_`. The `pre-commit` hook `cd`s into `web-app/` itself via `git rev-parse --show-toplevel`.
- **E2E auth without OAuth:** session cookies are forged with `encode` from `@auth/core/jwt` using salt `authjs.session-token` (the actual cookie prefix) — mirrors exactly what Auth.js does, so no provider/credentials are needed in CI. Cookie is `authjs.session-token`, `maxAge` 30d.
- **tRPC wire format:** the app configures **no transformer**, so responses are `{ result: { data: <raw> } }`. The initial mock wrapped data in `{ json: ... }` (superjson format), which made every query resolve to an object → `data.map is not a function` (admin) and `conversation.id` undefined (`/chat`). Dropping the wrapper fixed all nine failing specs.
- **StrictMode-safe mocks:** the chat spec uses a static persisted-conversation fixture and idempotent route mocks because React StrictMode fires effects twice (dev only) and the app double-fetches.
- **Error-banner assertion scoping:** Next.js injects a hidden route announcer that also has `role="alert"`, so the spec asserts on `getByRole("alert").filter({ hasText })` instead of a bare role query (strict-mode violation).
- **Cold-compile tolerance:** the landing specs bump the post-click URL assertion timeout to 15s because the first `/login` hit on a cold dev server compiles server-side.
- **Coverage columns:** vitest's table order is `% Stmts | % Branch | % Funcs | % Lines`; the gate thresholds (lines/functions/statements ≥ 80) are all met. Branch coverage (73.17% merged) is not gated.
- **`scan-secrets.mjs`:** pre-commit scans `git diff --cached` for AWS keys, PEMs, and `gsk_/hf_/sk-/ghp_/github_pat_` + `password/secret/token` patterns; skips lockfiles, markdown, and snapshots. Gitleaks in the security workflow covers the full push.
- **Debug script kept:** `scripts/debug-e2e.mjs` requires a running `pnpm dev` server and prints tRPC requests/responses/page errors; it's a dev-only utility (not part of any gate, not shipped).

## Notes for Next Phase

- E2E mocks tRPC/SSE; a seeded DB would allow real end-to-end flows. The e2e workflow already provisions pgvector (pg16) if `real` specs are added later.
- The `security-web-app.yml` gitleaks job needs `GITLEAKS_LICENSE`; the deploy workflow needs `VERCEL_TOKEN`/`VERCEL_ORG_ID`/`VERCEL_PROJECT_ID`. CI will show "expected checks" until these are set (or they are configured as required checks).
- `pnpm ingest --url <url>` on deploy seeds the knowledge base into Neon (Phase D pipeline).
- `pnpm lint` reports one warning (`import/no-anonymous-default-export` in `.lintstagedrc.mjs`); acceptable, but could be silenced with an eslint-ignore comment.
- The Message composite index ships as a manual migration; `prisma migrate deploy` in CI/Neon applies it.

## Verification

Waits on user verification of this push. After merge, CI (push to `web-app`) runs the `ci-web-app.yml` gate; deploying to Vercel requires the `VERCEL_*` secrets on the repo.
