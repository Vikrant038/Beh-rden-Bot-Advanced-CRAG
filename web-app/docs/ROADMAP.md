# Phase 4 — Implementation Roadmap (RFC → Atomic Tasks)

> **Source of truth:** `../../docs/WEB_APP_PLAN.md` (user-approved RFC), `../../docs/EXISTING_PROJECT_ANALYSIS.md`, `../../docs/basic-prompt/{GUARDRAILS,CODING_STANDARDS,PIPELINE_OPS,prompt_design}.md`
> **Risk tier:** Commercial/Production — all pillars/modules enforced.
> **Gate:** Requires `@ai-unblock-roadmap` before any implementation code.

---

## 0. Scope & Location

- **Repo:** this repository, branch `web-app`, app root `web-app/`. Original Python codebase untouched.
- **No Python runtime.** RAG pipeline reimplemented in TypeScript.
- **Module layout:** `web-app/src/server/{trpc,rag,llm,cache,memory,security,embeddings}` + `web-app/src/{app,components,hooks,lib,types}` per plan §3.

---

## 1. Atomic Task List (Bottom-Up)

### Stack / Foundations
| ID | Title | Layer | Verification |
|----|-------|-------|--------------|
| TASK-001 | Scaffold Next.js 15 + TS strict + ESLint/Prettier + Vitest/Playwright in `web-app/` | Setup | `pnpm build` + `pnpm lint` green |
| TASK-002 | Tailwind CSS v4 + shadcn/ui + design tokens + fonts | UI | Storybook-free build; tokens in globals.css |
| TASK-003 | Prisma schema (7 models + `vector` ext) + initial migration | DB | `prisma migrate dev` applies; `vector` enabled |
| TASK-004 | Two-role DB config (`DATABASE_URL` app / `MIGRATION_DATABASE_URL` CI) | DB | CI migration user can DDL; app user DML only |
| TASK-005 | tRPC v11 bootstrap + auth context + response envelope | API | tRPC client type-checks; 401 envelope on unauth |
| TASK-006 | NextAuth v5 (GitHub+Google+Email magic link, Prisma adapter, RBAC `USER`/`ADMIN`) | Auth | login/register flows; admin route guard |
| TASK-007 | Global error handler + `ErrorCode` registry + DomainError hierarchy + pino redaction logger | Core | error→status map; `[REDACTED]` in logs |
| TASK-008 | Rate limiter (Upstash sliding window: auth 5/15min/IP, public 100/15min) + CSRF policy | Security | 429 on exceed; mutating routes checked |
| TASK-009 | SSRF-safe fetch helper (`src/lib/security/url-validator.ts`) | Security | internal IP block tests pass |
| TASK-010 | Security headers + `/health` (deep: db/cache/apis) | Security | headers present; health JSON shape |

### RAG Core
| ID | Title | Layer | Verification |
|----|-------|-------|--------------|
| TASK-011 | PII masker TS port (IBAN, passport, DOB, phone, email, name) | RAG | all `test_rag_quality` PII cases pass |
| TASK-012 | Embedding client (HF Inference API, env `EMBEDDING_MODEL`) | RAG | 768-d vector round-trip |
| TASK-013 | LLM client (Groq primary + HF fallback, retry/backoff, semaphore, circuit breaker) | RAG | circuit breaker tests (closed→open→half-open) |
| TASK-014 | BM25 sparse retrieval (TS port of Okapi) | RAG | scoring tests |
| TASK-015 | pgvector dense retrieval (Prisma `$queryRaw`, cosine, min_sim 0.20, k=15) | RAG | SQL tests |
| TASK-016 | RRF fusion (k=60) | RAG | fusion unit tests |
| TASK-017 | HybridRetriever (dense + sparse + RRF → top-15) | RAG | integration test |
| TASK-018 | Cross-encoder re-ranker via HF Inference API (top_k=5) | RAG | rerank ordering test |
| TASK-019 | CRAG gate (≥0.50; fail → web search fallback) | RAG | pass/fail paths |
| TASK-020 | Domain guardrail Stage-0A (off-topic/illegal block + negative cache) | RAG | in/out-of-domain tests |
| TASK-021 | Query disambiguation Stage-0B (vague query → 3 options) | RAG | disambiguation tests |
| TASK-022 | Multi-query expansion (LLM → 3 sub-queries) | RAG | expansion tests |
| TASK-023 | Web search tool (`duck-duck-scrape`) + result synthesis | RAG | mocked search tests |
| TASK-024 | Visa calculator tool (992 EUR/mo × 12, 90 INR/EUR) | RAG | math tests |
| TASK-025 | Semantic cache (Redis exact hash + pgvector cosine ≥0.97, 7-day TTL enforced) | RAG | cache write/read/TTL tests |
| TASK-026 | Summary-buffer memory (last 8 verbatim + ~300-token summary) | RAG | memory tests |
| TASK-027 | Standard CRAG pipeline orchestrator | RAG | pipeline integration test |
| TASK-028 | 3-Agent ReAct pipeline (Research→Analyst→Writer, Zod-validated AnalystMatrix) | RAG | agentic pipeline integration test |

### API / UI
| ID | Title | Layer | Verification |
|----|-------|-------|--------------|
| TASK-029 | tRPC routers: chat, conversation, source, document(admin), admin | API | tRPC tests; RBAC enforced |
| TASK-030 | SSE stream route `/api/chat/stream` (status/token/disambiguation/done events) | API | e2e stream test |
| TASK-031 | `useChat` hook (SSE consumer, abort, timeout) | UI | hook test (MSW) |
| TASK-032 | Chat interface (messages, bubbles, streaming text, sources, matrix, typing) | UI | component tests |
| TASK-033 | Sidebar + conversation CRUD + mobile nav | UI | component tests |
| TASK-034 | History page + Settings page | UI | component tests |
| TASK-035 | Landing page (hero + feature grid) | UI | Lighthouse 90+ |

### Admin / Data
| ID | Title | Layer | Verification |
|----|-------|-------|--------------|
| TASK-036 | Document sync (transactional re-chunk/re-embed + cache invalidation) | API | sync integration test |
| TASK-037 | Admin dashboard (metrics + Recharts) + admin documents UI | UI | RBAC test; admin e2e |
| TASK-038 | Ingest pipeline (PDF/URL→clean→chunk 600/150→embed→store) + CLI | Data | ingest golden-file test |
| TASK-039 | Cache TTL cleanup cron (Vercel Cron) + Langfuse tracing | Ops | cron route; trace spans |

### Delivery
| ID | Title | Layer | Verification |
|----|-------|-------|--------------|
| TASK-040 | CI: `ci.yml` + `security.yml` (CodeQL/Semgrep/Gitleaks/SBOM) + `e2e.yml` + `deploy.yml` | Ops | green pipeline |
| TASK-041 | Husky pre-commit (lint/format/type/secret scan) | Ops | commit blocked on violation |
| TASK-042 | E2E (Playwright): chat flow, disambiguation, auth, admin | QA | all specs pass |
| TASK-043 | README + `.env.example` sync + SECURITY_EXCEPTIONS.md + CHANGELOG | Docs | doc checklist |
| TASK-044 | Vercel deploy + Neon + Upstash env sync + smoke test | Ops | /health 200 + smoke pass |

---

## 2. Traceability Matrix (Shall → Tasks)

| Requirement (WEB_APP_PLAN §7/§14) | Tasks |
|---|---|
| 3-Agent ReAct | TASK-028 |
| Hybrid retrieval (dense+sparse+RRF+rerank) | TASK-014..018 |
| CRAG gate + web fallback | TASK-019, TASK-023 |
| PII masking | TASK-011 |
| Semantic cache + TTL | TASK-025 |
| Summary-buffer memory | TASK-026 |
| Guardrail + disambiguation | TASK-020, TASK-021 |
| Query expansion | TASK-022 |
| Resilient LLM client | TASK-013 |
| Langfuse observability | TASK-039 |
| Auth + RBAC | TASK-006 |
| SSE streaming chat | TASK-030..032 |
| Admin metrics + doc sync | TASK-036..038 |
| Quality gates (lint/type/unit/e2e) | TASK-040..042 |
| Zero-downtime migration + PoLP | TASK-003..004 |

---

## 3. Change-Control Acknowledgment (vs earlier draft plan)

Per CCI (prompt_design §6.0): the user's `../../docs/WEB_APP_PLAN.md` supersedes my root-level draft. Recorded deltas: tRPC replaces REST-first API; NextAuth providers replace Credentials-only; HF Inference embeddings replace OpenAI-compatible; same-repo `web-app/` branch replaces separate repo.

---

*Awaiting `@ai-unblock-roadmap` to proceed to Phase 5 (Test Design).*
