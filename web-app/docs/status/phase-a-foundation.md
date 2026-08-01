# Phase A — Foundation

**Status:** COMPLETE (pending user verification)
**Date:** 2026-07-31
**Branch:** `web-app`
**Scope:** ROADMAP TASK-001..010

## Summary

Greenfield Next.js 15 + TypeScript web app scaffolded in `web-app/`, with auth (NextAuth v5), tRPC bootstrap, Prisma + pgvector schema, security primitives, and CI-quality gates passing.

## Tasks Delivered

| Task | Deliverable | Status |
|---|---|---|
| TASK-001 | Scaffold Next.js 15.5.22 (App Router, TS strict, Tailwind v4, ESLint 9) in `web-app/` | Done |
| TASK-002 | Dependencies installed (trpc 11, next-auth beta.32, prisma 6.19.3, upstash, pino, zod 4, vitest 4, playwright) | Done |
| TASK-003 | Prisma schema (7 models) + initial migration + HNSW vector indexes + `prisma generate` | Done |
| TASK-004 | `.env.example` + `.env` (split DB roles, OAuth, HF, Groq, Upstash, Langfuse) | Done |
| TASK-005 | Server libs: env, db, errors, logger, response envelope | Done |
| TASK-006 | Security libs: SSRF URL validator, Upstash + fallback rate limiter | Done |
| TASK-007 | Auth stack: `auth.config.ts`, `server/auth.ts`, type augmentation, route, middleware RBAC | Done |
| TASK-008 | tRPC bootstrap: context, router (public/protected/admin), fetch route | Done |
| TASK-009 | Security headers (CSP/HSTS/etc.) in `next.config.ts` + deep `/api/health` route | Done |
| TASK-010 | Font self-hosting (Google Fonts blocked → `@fontsource-variable/*`) + theme config | Done |

## Quality Gates

| Gate | Command | Result |
|---|---|---|
| Typecheck | `pnpm typecheck` | PASS |
| Lint | `pnpm lint` | PASS (0 errors, 0 warnings) |
| Build | `pnpm build` | PASS (routes: /, /api/auth, /api/health, /api/trpc, middleware) |
| Format | `pnpm format:check` | not run (pending) |
| Unit tests | `pnpm test` | N/A (no test-first units in Phase A; first units land in Phase B) |

## Decisions & Exceptions

- Prisma pinned to `6.19.3` (v7 breaking changes; `postgresqlExtensions` preview for `extensions = [vector]`).
- pnpm 11 requires `allowBuilds` in `pnpm-workspace.yaml` (no longer reads package.json `pnpm` field).
- Google Fonts blocked at network level → self-hosted `@fontsource-variable/inter` + `jetbrains-mono`.
- CSRF: Auth.js defaults (`SameSite=Lax`) per user override — logged in `docs/security/SECURITY_EXCEPTIONS.md`.
- Two DB roles: `DATABASE_URL` (DML) vs `MIGRATION_DATABASE_URL` (DDL).
- JWT session strategy; `Session.user` augmented with `id` + `role`.

## Notes for Next Phase

- `appRouter` is currently an empty stub; feature routers attach in Phase C.
- Landing `page.tsx` is still the scaffold template (built out in Phase C TASK-035).
- No local Postgres/Docker — migrations generated via `prisma migrate diff --from-empty`; apply against Neon in CI/deploy.
- Tests (unit + integration + e2e skeletons) start in Phase B per TEST_DESIGN.md.

## Verification

Waits on user verification of this push before Phase B begins (TASK-011..028).

### Recent Fixes (2026-08-01)
- Fixed NextAuth `MissingCSRF` and `404/undefined` client ID issues in the OAuth flow.
- Fixed an infinite redirect loop caused by unauthenticated users accessing protected routes.
- Added `src/app/api/health/route.ts` diagnostic endpoint to help test and debug outbound network connectivity blocks.
