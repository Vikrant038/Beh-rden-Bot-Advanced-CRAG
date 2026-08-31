# Test Suites — Where Everything Lives

The repository intentionally has **two fully separate test suites** that never
share a runner, a CI job, or a dependency graph. They cover two different
surfaces of the product and are owned by different CI pipelines.

| Suite | Location | Stack | CI workflow | Covers |
|-------|----------|-------|-------------|--------|
| **Web app** | [`web-app/tests/`](../../web-app/tests/) | Vitest (unit + integration) + Playwright (E2E) | `ci-web-app.yml`, `e2e-web-app.yml` | The production Next.js app: UI components, tRPC routers, the TypeScript CRAG pipeline, guest sessions, API routes |
| **Python / Streamlit (reference + eval)** | [`tests/`](./) | pytest + RAGAS | — (not CI-gated; reference only) | The Python reference RAG implementation, fine-tuning eval, and the RAGAS quality harness (`eval_ragas*.py`) |

> **Why two suites?** The web app is the shipped product (TypeScript). The root
> Python code is the research/reference implementation the TS side was ported
> from, plus the offline RAGAS evaluation harness. They share a design, not
> runtime code — so they also share no test runner.

---

## Running the Web App suite

```bash
cd web-app

# Unit + integration (Vitest; runs both the server and components projects)
pnpm test

# Coverage gate (thresholds enforced in vitest config — lines/functions/branches/statements)
pnpm vitest run --coverage

# Typecheck + lint + production build (also enforced in CI)
pnpm typecheck
pnpm lint
pnpm build

# E2E (Playwright — desktop chromium + mobile-chromium viewports)
pnpm test:e2e
```

CI environment variables (placeholders are fine locally; tests mock
Prisma/network):

```bash
DATABASE_URL=postgresql://behoerden_app:behoerden_password@localhost:5432/behoerden_bot
MIGRATION_DATABASE_URL=postgresql://behoerden_migrator:behoerden_password@localhost:5432/behoerden_bot
NEXTAUTH_SECRET=ci-placeholder-secret-not-used-by-tests
```

E2E additionally needs a reachable Postgres (the dev server boots against it)
and Playwright browsers installed (`pnpm exec playwright install --with-deps chromium`).

## Running the Python suite

```bash
# From mvp-python/ (the venv lives at the repo root)
cd mvp-python
../.venv/bin/python -m pytest tests/ -x -q

# RAGAS quality evaluation (LLM-judged gate report)
../.venv/bin/python -m tests.eval_ragas
```

Requires `mvp-python/requirements.txt` and `GROQ_API_KEY` / `HF_TOKEN` for
the LLM-judged metrics.

## CI ownership (verify with each change)

- **Web app** changes under `web-app/**` trigger `ci-web-app.yml` (lint,
  typecheck, unit/integration, coverage, build) and `e2e-web-app.yml`
  (Playwright incl. the mobile viewport project). Neither touches Python.
- **Python** changes are **not** CI-gated — the MVP is a reference
  implementation. The production pipeline's quality gate is the web-app
  30-question eval (`eval-web-app.yml`, see `web-app/docs/EVALUATION.md`).
- A change touching both sides only runs the web-app pipelines — that is
  expected, not a bug.

## Writing new tests

- Web-app UI/logic → `web-app/tests/unit` (components) or
  `web-app/tests/integration` (tRPC routers, API routes).
- Web-app user flows → `web-app/tests/e2e` (Playwright; every spec also runs
  at a phone viewport via the `mobile-chromium` project).
- Python retrieval/eval logic → `mvp-python/tests/test_*.py`; quality gates → extend
  `mvp-python/tests/eval_ragas.py` (or the production harness
  `web-app/scripts/eval-crag-webapp.ts`).
