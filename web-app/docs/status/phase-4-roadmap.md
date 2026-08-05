# Phase 4 — Implementation Roadmap: Status

- **Status:** COMPLETE
- **Date:** 2026-07-31
- **Gate:** `@ai-unblock-roadmap` (approved by user 2026-07-31).

## Deliverable
`web-app/docs/ROADMAP.md` — 44 atomic tasks (TASK-001..TASK-044), bottom-up: Foundations → RAG Core → API/UI → Admin/Data → Delivery, with traceability matrix and CCI acknowledgment.

## Tasks by Bucket
- **Foundations (001–010):** scaffold, Tailwind/shadcn, Prisma + two-role DB, tRPC, NextAuth, errors/logger, rate limiter + CSRF, SSRF guard, headers/health.
- **RAG Core (011–028):** PII, embeddings, LLM client, BM25, pgvector, RRF, hybrid, reranker, CRAG gate, guardrail, disambiguation, expansion, web search, visa calculator, semantic cache, memory, standard + agentic pipelines.
- **API/UI (029–035):** tRPC routers, SSE stream, useChat hook, chat UI, sidebar/mobile, history/settings, landing.
- **Admin/Data (036–039):** doc sync, admin dashboard, ingest pipeline, TTL cron + Langfuse.
- **Delivery (040–044):** CI/security/e2e/deploy workflows, Husky, E2E specs, docs, Vercel deploy.

## Traceability Verified
Every SHALL requirement from Phase 2 maps to ≥1 task (see ROADMAP §2). No orphaned requirements.
