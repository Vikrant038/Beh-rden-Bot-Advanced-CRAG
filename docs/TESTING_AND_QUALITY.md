# Testing & Quality — Behörden-Bot

> **"Tests define done."** This document is the full quality system: what we test, how we test it, what the gates are, and how we evaluate the *RAG itself* — because a UI test suite cannot tell you whether the answers are correct.

---

## The four-layer system

Quality is enforced as layers, each catching what the layer below cannot:

```
Layer 4  RAG evals          ← does the ANSWER quality hold? (this is the product)
Layer 3  E2E (Playwright)   ← do the user flows work? (chat, history, admin)
Layer 2  Unit + integration ← does each piece work? (routers, stages, components)
Layer 1  Static gates       ← is the code clean? (lint, format, typecheck, secrets)
```

### Layer 1 — Static gates (fastest feedback)

| Gate | Command | Enforced by |
|---|---|---|
| Format | `pnpm format:check` (Prettier) | CI **and** pre-commit |
| Lint | `pnpm lint` (ESLint) | CI **and** pre-commit |
| Typecheck | `pnpm typecheck` (`tsc --noEmit`) | CI |
| Secrets | Gitleaks + Husky credential scan | CI **and** pre-commit |
| Semgrep | security pattern scan | CI (`security-web-app.yml`) |

Why format is a gate, not a suggestion: the "CI broke on the latest push" incident was Prettier drift across 8 files. Formatting differences create noise that hides real diffs in review — so we made it mechanical.

### Layer 2 — Unit + integration (Vitest)

- **840+ tests across 82 files**, run with `pnpm test` (branch coverage floor 85%).
- **Unit:** pure logic — RAG stages (guardrail, sub-queries, RRF, rerank scoring), cache payload parsing, conversation policy, PII masking, sparse retriever dispatch, telemetry aggregation.
- **Integration:** tRPC routers (conversation, admin, public) against **mocked Prisma** — fast, deterministic, no DB needed in CI (CI exports placeholder env for zod validation only).
- **Component:** chat components with behavioral contracts — message bubbles, pipeline status, chat input (mode toggle, paste, char counter, MAX_QUERY_LENGTH), empty state (prompt cards + submit contract), source citations (pdf:// handling, favicons), theme toggle, UI primitives.

The DB-layer refactor (row→domain mapping, analytics, conversation policy, sparse retriever) added dedicated tests — e.g. `sparse-retriever.test.ts` covers the FTS path, the BM25 fallback, and index memoization.

### Layer 3 — Coverage gate (85%)

`pnpm vitest run --coverage` in CI enforces an **85% floor** across the app. The floor is deliberately aggressive because:

- The RAG pipeline is the product — untested stages are unverified claims.
- It caught real gaps: the pipeline visualizer's pre/post-processing branches, telemetry branches, and the admin router's error paths all needed tests to pass the gate.
- New features must ship with tests (the pipeline-tester retention feature, session-aware CTAs, and the responsive work all landed with their tests in the same commit).

### Layer 4 — E2E (Playwright)

Six Playwright specs cover the real user journeys — chat (send → stream → cited answer → follow-up), history, admin, auth, and the landing page. E2E has repeatedly earned its keep:

- It caught the **closed-accordion regression**: when the pipeline tester switched to closed-by-default accordions, E2E failed because it interacted with them — a real UI-behavior break that unit tests structurally cannot see.
- It validated the **phone-view fix** (send/paste button alignment, chevron hit-target) as a regression test, not a one-off screenshot.

**Before merge, everything must pass:** `pnpm test` + `pnpm vitest run --coverage` + `pnpm test:e2e` + `pnpm build` (the production build also validates the CSP nonce path).

---

## Evaluating the RAG itself

A normal test suite cannot answer "is the answer correct?" — only the pipeline's own metrics can. We run **RAGAS-style evaluations** on both implementations.

### The testset — `web-app/data/eval/crag_30_questions.json`

30 hand-built questions grounded in the *actual corpus*, engineered to probe specific failure modes:

- **18 topics** from the real data: blocked account, APS, uni-assist, Goethe-Zertifikat, TestDaF, Residence Act/Ordinance, Anmeldung, visa documents, Fintiba, recognition, tax, EU Blue Card, health insurance, universities, BAMF/KMK.
- **Multilingual:** 24 English + 6 German (German parity is a first-principles requirement — see [FIRST_PRINCIPLES.md](FIRST_PRINCIPLES.md)).
- **Adversarial traps:** a recipe request (out-of-domain) and a fraud request (faking an APS) — the safety dimension.
- Each item carries a `ground_truth_answer`, expected keywords, retrieval hints, and a metric-focus tag.

### The metrics

| Metric | What it measures | Gate |
|---|---|---|
| Faithfulness / groundedness | Is every claim in the answer supported by the retrieved context? | ≥ 3.5 / 5.0 |
| Answer relevance (judge) | Does the answer actually address the question? | ≥ 4.0 / 5.0 |
| Answer relevance (BGE-M3) | Semantic similarity of answer ↔ question (multilingual judge) | ≥ 0.55 |
| Context precision | Are the retrieved chunks relevant (noise ratio)? | ≥ 75% |
| Context recall | Do the retrieved chunks cover the needed facts? | ≥ 70% |
| Trap handling | Does the system refuse out-of-domain / fraudulent requests? | 2/2 |

### The harnesses

- **Python reference:** `mvp-python/tests/eval_ragas.py` — LLM-judges answers from `mvp-python/src/rag.py` on faithfulness, relevance, and precision.
- **Production TS pipeline:** `web-app/scripts/eval-crag-webapp.ts` — runs the 30-question multilingual testset through the real web-app CRAG (guardrail → English-first query expansion (`{ language, queries }`) → pgvector+BM25 hybrid → cross-encoder rerank → Groq), using the local embed/rerank servers when HF inference is unreachable.

### What the evals found (and fixed)

1. **Judge noise under rate limits** → timeouts + atomic checkpoint; re-judged clean.
2. **Judge context truncation** → the TS judge now receives the *real* generator context; identical answers scored 2.0 → 5.0.
3. **No safety guardrail** → traps scored 0/2 (the bot wrote a recipe and offered a forged APS); the deterministic negative/safety term cache (fail-closed) brought traps to **2/2** with zero false positives.
4. **Context recall on multi-entity items** → diagnosed as retrieval-width compression (verified: keywords exist in corpus *and* fused pool; a 5-chunk window can't enumerate 4–6 entities), not a hallucination defect.

**Current scorecards (30-question testset; the TS harness scores all four axes):**

| Metric | Python reference | Web-app (production TS) | Gate |
|---|---|---|---|
| Faithfulness | 3.69 | **3.98** | ≥ 3.5 ✅ |
| Relevance (judge) | 4.50 | **4.83** | ≥ 4.0 ✅ |
| Relevance (BGE-M3) | 0.74 | 0.70 | ≥ 0.55 ✅ |
| Context precision | 100% | **100%** | ≥ 75% ✅ |
| Context recall | 59.8% | **72.1%** | ≥ 70% ✅ |
| Traps / refusal | 2/2 | **2/2** | 2/2 ✅ |

The production pipeline clears **all six gates** (30/30 scored, resumable across rate-limit outages). The Python side still misses recall on multi-entity synthesis items — a diagnosed retrieval-width tradeoff, not a hallucination defect. By-language note (web-app): EN (n=24) faith 4.21 vs DE (n=6) faith 3.08 — German faithfulness is the next improvement target.

---

## Python-side tests

The research side has its own suite (`pytest`):

- `test_rag_quality.py` — **9 real queries** through the pipeline: in-scope questions must pass, out-of-scope and security-adjacent queries must be rejected. Behavior, not mocks.
- `test_tracing.py` — Langfuse span typing and attribute propagation.
- `test_embeddings.py`, `test_document_sync.py`, `test_hf_client.py` and the eval scripts (`eval_ragas.py`, `src/generate_testset.py`, `src/run_comparative_benchmark.py`).

> **Known environment note:** `test_rag_quality.py`'s in-scope cases currently hit a FAISS dimension mismatch (768-d default model vs. 1024-d BGE-M3 corpus) — proven pre-existing by stash-testing the base commit. The guardrail rejection tests pass; the in-scope cases await a model/index reconciliation.

---

## CI pipelines (`.github/workflows/`)

| Workflow | Purpose |
|---|---|
| `ci-web-app.yml` | Format → lint → typecheck → unit+integration → **coverage gate** → production build |
| `e2e-web-app.yml` | Playwright E2E suite |
| `rag_eval_ci.yml` | Python RAG quality gate (faithfulness/relevance/precision) |
| `security-web-app.yml` | Gitleaks + Semgrep |
| `deploy-web-app.yml` | Production deployment (Vercel) |

Local pre-commit (Husky) mirrors the fast gates so CI failures are rare and cheap: format, lint, and a credential scan on staged files.

---

## Running everything

```bash
# Web app
cd web-app
pnpm format:check && pnpm lint && pnpm typecheck   # static gates
pnpm test                                          # unit + integration
pnpm vitest run --coverage                         # 85% coverage gate
pnpm test:e2e                                      # Playwright
pnpm build                                         # production build

# Python evals (repo root)
.venv/bin/python -m tests.eval_ragas              # LLM-judged quality eval
```

---

*The goal is not "green checks" — it's that a merge can't make the product worse without someone noticing. The gates are the mechanism; the evals are the conscience.*
