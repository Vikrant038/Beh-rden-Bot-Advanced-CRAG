# Contributing to Behörden-Bot

Thank you for your interest in contributing. This document covers everything
you need to get set up, the standards the codebase enforces, and how to submit
changes.

---

## Table of Contents

1. [Before You Start](#1-before-you-start)
2. [Setting Up Locally](#2-setting-up-locally)
3. [Project Structure at a Glance](#3-project-structure-at-a-glance)
4. [Making a Change](#4-making-a-change)
5. [Code Standards](#5-code-standards)
6. [The Quality Gate — Must Pass Before Merge](#6-the-quality-gate--must-pass-before-merge)
7. [Commit Message Convention](#7-commit-message-convention)
8. [Submitting a Pull Request](#8-submitting-a-pull-request)
9. [Reporting Bugs](#9-reporting-bugs)
10. [Security Issues](#10-security-issues)
11. [What We Are Not Looking For](#11-what-we-are-not-looking-for)

---

## 1. Before You Start

- Read the [README](README.md) — especially the architecture overview and
  the evaluation scorecard. Understanding what the system does and how it
  measures itself is essential context for any change.
- Read [AGENTS.md](AGENTS.md) — the operational guide covering repo structure,
  all commands, CI workflows, and pipeline thresholds.
- For architectural questions, read
  [`web-app/docs/ARCHITECTURE.md`](web-app/docs/ARCHITECTURE.md).
- For the "why" behind every major decision, read
  [`docs/FIRST_PRINCIPLES.md`](docs/FIRST_PRINCIPLES.md).

If you are planning a large change (new retrieval stage, schema migration,
new auth provider), open an issue first to discuss the approach before
writing code. This avoids wasted effort if the direction doesn't fit.

---

## 2. Setting Up Locally

### Requirements

- **Node.js 22+** and **pnpm 11.20.0** (pinned — use `corepack enable` or
  install pnpm directly)
- **Docker** (for local PostgreSQL with pgvector)
- **Python 3.14+** and a virtual environment (for the MVP reference and
  evaluation harness)

### Web app

```bash
cd web-app
pnpm install
cp .env.example .env          # fill in secrets — see .env.example comments
docker compose up -d postgres  # pgvector/pgvector:pg16
pnpm prisma generate
DATABASE_URL="postgresql://behoerden_migrator:behoerden_password@localhost:5432/behoerden_bot" \
  pnpm prisma migrate deploy
pnpm dev                       # http://localhost:3000
```

For local embedding and reranking (needed for full RAG pipeline in dev):

```bash
# From the repo root — uses the .venv Python environment
.venv/bin/python mvp-python/scripts/embed-server.py   # BGE-M3 on :8765
.venv/bin/python scratch/rerank-server.py             # bge-reranker on :8766
```

Set `EMBEDDING_URL=http://localhost:8765` and `RERANKER_URL=http://localhost:8766`
in your `web-app/.env`.

### Python MVP (reference + evaluation)

```bash
# venv lives at repo root
python -m venv .venv
.venv/bin/pip install -r mvp-python/requirements.txt
cd mvp-python
docker compose up -d postgres   # MVP's own compose — port 5432 (don't run both at once)
cp .env.example .env
```

Full setup walkthrough: [`mvp-python/docs/FIRST_TIME_SETUP_GUIDE.md`](mvp-python/docs/FIRST_TIME_SETUP_GUIDE.md).

---

## 3. Project Structure at a Glance

```
Repo-2/
├── web-app/          # Production app — Next.js 15, TypeScript, tRPC, Prisma
│   ├── src/server/rag/   # The RAG pipeline — touch with care, eval-gate enforced
│   ├── src/server/db/    # Centralized data layer — all raw SQL lives here
│   ├── prisma/           # Schema + migrations
│   └── tests/            # Vitest unit/integration + Playwright E2E
├── mvp-python/       # Python reference + evaluation harness (not shipped)
├── Docs/             # Project-level design and showcase docs
└── .github/workflows/ # CI, E2E, security, CRAG eval
```

Full structure with responsibility matrix:
[`web-app/docs/ARCHITECTURE.md`](web-app/docs/ARCHITECTURE.md).

---

## 4. Making a Change

### Identify the right layer

The ARCHITECTURE doc defines strict layer rules. The most important ones:

- **Business logic** goes in `src/server/rag/` or `src/server/routers/` —
  never directly in API route handlers.
- **All raw SQL** goes in `src/server/db/vector-queries.ts` or
  `src/server/db/analytics.ts` — never scattered across files.
- **React components** must not contain business logic or database access.
- Changes to the RAG pipeline stages should be accompanied by a run of the
  eval harness (`pnpm tsx scripts/eval-crag-webapp.ts`) to verify no
  regression in faithfulness or recall.

### Adding a new dbt model / database migration

Run `pnpm prisma migrate dev --name describe_your_change` — never edit
migration files by hand.

### Changing RAG pipeline thresholds

Document the change with before/after eval scores. The CRAG threshold (0.50),
cache cosine similarity (0.97), and reranker top-k are all calibrated against
the 30-question testset — changing them without a re-evaluation is a
regression risk.

---

## 5. Code Standards

These are enforced automatically by Husky pre-commit hooks and CI — you
cannot merge without passing them.

| Standard | Tool | Config |
| -------- | ---- | ------ |
| Formatting | Prettier | `.prettierrc` |
| Linting | ESLint | `eslint.config.mjs` |
| Type checking | TypeScript `tsc --noEmit` | `tsconfig.json` |
| Secret scanning | Gitleaks (CI) + Husky lightweight scan (local) | `.semgrepignore` |
| SQL injection prevention | Parameterized queries only — `Prisma.sql` for raw SQL | enforced in review |

**No hardcoded secrets.** Environment variables only. `.env` is gitignored.
The pre-commit hook and CI both scan for credential patterns. A commit that
leaks a key will be blocked.

**Zod schemas for all inputs.** Every tRPC procedure input must have a Zod
schema. Every external API response that enters the pipeline must be validated
with Zod before use.

**TypeScript strict mode.** No `any` without a documented reason. Prefer
explicit `unknown` + type guard over `any`.

---

## 6. The Quality Gate — Must Pass Before Merge

All of these must be green before a PR can merge:

```bash
cd web-app

pnpm format:check          # Prettier
pnpm lint                  # ESLint
pnpm typecheck             # tsc --noEmit
pnpm test                  # Vitest unit + integration
pnpm exec vitest run --coverage   # ≥85% coverage floor
pnpm build                 # production build
pnpm test:e2e              # Playwright (requires local Postgres + dev server)
```

CI runs all of the above automatically on every PR via `ci-web-app.yml` and
`e2e-web-app.yml`.

For changes touching the RAG pipeline, also run:

```bash
pnpm tsx scripts/eval-crag-webapp.ts   # 30-question CRAG eval
```

And include the before/after scorecard in your PR description.

---

## 7. Commit Message Convention

We follow **Conventional Commits**:

```
<type>(<scope>): <short summary>

[optional body]

[optional footer]
```

**Types:**

| Type | When to use |
| ---- | ----------- |
| `feat` | New feature |
| `fix` | Bug fix |
| `perf` | Performance improvement |
| `refactor` | Code change with no behaviour change |
| `test` | Adding or fixing tests |
| `docs` | Documentation only |
| `chore` | Build tooling, config, dependencies |
| `ci` | CI workflow changes |
| `security` | Security fix or hardening |

**Examples:**

```
feat(rag): add bilingual query expansion for Dutch queries
fix(auth): correct magic link expiry handling on mobile Safari
perf(db): add GIN index on messages.content for FTS
docs: add USER_GUIDE.md and PRIVACY_AND_GDPR.md
test(guardrail): add adversarial trap for forged-APS request
```

Keep the summary under 72 characters. Use the body for "why", not "what" —
the diff shows what changed.

---

## 8. Submitting a Pull Request

1. **Fork** the repository and create a branch from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```
2. Make your changes, following the standards above.
3. Run the full quality gate locally before pushing.
4. Push your branch and open a Pull Request against `main`.
5. Fill in the PR description:
   - **What** the change does
   - **Why** it is needed
   - **How** to test it
   - Eval scorecard diff (for RAG pipeline changes)
   - Any known limitations or follow-up work
6. The CI suite runs automatically. All checks must be green before review.
7. Address review comments. Do not force-push after a review has started —
   add new commits instead so the reviewer can see what changed.

**PR size:** Keep PRs focused. A PR that changes the RAG pipeline, the UI,
and the database schema simultaneously is hard to review safely. Prefer
smaller, targeted PRs.

---

## 9. Reporting Bugs

Open a **GitHub Issue** using the Bug Report template (if available) or with
the following structure:

```
**Environment:** OS, Node version, pnpm version, browser (for UI bugs)
**What I expected:** ...
**What actually happened:** ...
**Steps to reproduce:** (numbered, minimal)
**Relevant logs or screenshots:** (attach, don't paste huge log blocks inline)
```

Before filing, check existing open and closed issues to avoid duplicates.

Do not include personal data (visa details, passport numbers, real names) in
public issues.

---

## 10. Security Issues

**Do not report security vulnerabilities in public GitHub Issues.**

Follow the process in [`SECURITY.md`](SECURITY.md) — private GitHub Security
Advisory or direct contact. This keeps the vulnerability confidential until
a fix is in place.

---

## 11. What We Are Not Looking For

To save everyone's time, here is what we will decline:

- PRs that add new npm/pip dependencies without a clear, documented need and
  version pinning.
- Changes to RAG pipeline thresholds without eval score evidence.
- Cosmetic reformatting of files not otherwise changed in the PR.
- Adding `console.log` or debug statements without removing them.
- Changes that reduce test coverage below the 85% floor.
- Removing PII masking, the CRAG confidence gate, or the guardrail — these
  are intentional safety mechanisms, not optional features.

---

*Thank you for contributing. Every improvement to this system makes German
bureaucracy a little more navigable for the people who need it.*
