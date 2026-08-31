# Phase 1 — Discovery Loop: Status

- **Status:** COMPLETE
- **Date:** 2026-07-31
- **Gate:** Discovery closed via Q&A with user (embedding strategy, fine-tuned model, auth providers, deploy target, seed data, CSRF, DB roles).

## Objective
Greenfield full-stack TS web app reimplementing Behoerden-Bot (Repo-2) RAG business logic, with the original repo never modified.

## Personas
- **USER** — Indian student / applicant researching German immigration, visa, APS, university, finance.
- **ADMIN** — manages documents, monitors metrics, triggers syncs.

## Constraints
- Next.js 15 + tRPC + Prisma + pgvector (Neon) + NextAuth v5 + Tailwind v4 + shadcn/ui + Upstash Redis + Vercel.
- No Python runtime. Source of truth: `../../../docs/basic-prompt/*` + the user's existing-project analysis (since removed from `mvp-python/docs/`) + `../../../docs/WEB_APP_PLAN.md`.

## Metrics
- CI quality gates: lint/type/unit/E2E green; RAGAS-equivalent eval thresholds preserved (Faithfulness ≥3.50, Relevance ≥4.00, Context Precision ≥75%).

## Key Decisions
- Embeddings: HF Inference API, base `BAAI/bge-base-en-v1.5`, env-swappable (`EMBEDDING_MODEL`).
- Auth: NextAuth v5 GitHub + Google + Email magic link (Resend).
- Deploy: Vercel + Neon + Upstash.
- Seed data: full ingest pipeline, populate later.
- CSRF: Auth.js defaults (SameSite=Lax) — human override of GUARDRAILS M2.5, to be logged in `SECURITY_EXCEPTIONS.md`.
- DB roles: `App_ReadWrite` + `Migration_User`.
- Location: branch `web-app`, app in `web-app/`.
