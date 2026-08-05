# Phase 4 — Test & Verification Guide

**Status:** DONE — verify on a machine with a live PostgreSQL + pgvector DB
**Date:** 2026-08-02
**Branch:** `web-app`
**Scope:** Unit tests, integration tests, e2e specs, and quality gates for the pipeline visualizer + PDF ingestion stack.

This document lists the exact commands and the expected output for every test area added in Phase 4. Run each command from `web-app/`.

> **Env note:** the sandbox has no `.env`, so unit tests/build require injected env vars. The full gate commands below include them. On a machine with `.env` (DB + secrets) you can drop the prefix.

```bash
cd web-app
export DATABASE_URL="postgresql://behoerden_user:behoerden_password@localhost:5432/behoerden_bot"
export NEXTAUTH_SECRET="a-32-byte-secret-string"
```

---

## 0. Quick reference

| Area | Command | Expected |
|------|---------|----------|
| Typecheck | `pnpm typecheck` | exit 0, no output |
| Lint | `pnpm lint` | 0 errors (1 pre-existing `.lintstagedrc.mjs` warning) |
| Full unit/integration/component suite | `pnpm test` | 41 files / **280 tests** pass |
| New Phase-4 unit files only | `pnpm vitest run <files>` | 6 files / **62 tests** pass |
| Build | `pnpm build` | compiled OK, `/admin/pipeline-tester` generated |
| E2E spec compile | `pnpm exec playwright test --list` | 21 tests / 6 files listed |
| E2E run (needs DB + LLM keys + `pnpm dev`) | `pnpm test:e2e` | 21 tests pass |

---

## 1. Quality gates

### 1.1 Typecheck

```bash
pnpm typecheck
```

Expected: exit code 0, no stdout (the script is `tsc --noEmit`).

### 1.2 Lint

```bash
pnpm lint
```

Expected output tail:

```
✖ 1 problem (0 errors, 1 warning)
```

The only warning is the pre-existing `import/no-anonymous-default-export` on `.lintstagedrc.mjs:1` — unchanged by Phase 4.

### 1.3 Full unit + integration + component suite

```bash
pnpm test
```

Expected output tail:

```
 Test Files  41 passed (41)
      Tests  280 passed (280)
```

Phase 4 added 3 test files and extended 3 existing ones: `280` total tests (up from `242`).

---

## 2. New unit test files (Phase 4)

Each file runs standalone via `pnpm vitest run <path>`. All of these require `DATABASE_URL` + `NEXTAUTH_SECRET` only because `tests/setup.ts` imports `@/server/db` transitively.

### 2.1 `tests/unit/pdf-parser.test.ts` (9 tests)

```bash
pnpm vitest run tests/unit/pdf-parser.test.ts
```

Expected: `Test Files 1 passed | Tests 9 passed`. Cases:

| Test | Expected behaviour |
|------|--------------------|
| extracts text, pages, metadata | `parsePdf` returns `{ text, pages: 3, metadata }` |
| empty buffer | throws `PdfParseError` "Empty PDF buffer", pdf-parse not called |
| image-only PDF | throws "PDF contains no extractable text (scanned/image-only?)" |
| >200 pages | throws "PDF exceeds 200 pages" |
| pdf-parse throws | re-thrown as `PdfParseError` preserving the inner message |
| constants | `MAX_PDF_BYTES === 4 MiB`, `MAX_PDF_PAGES === 200`, `ACCEPTED_MIME === "application/pdf"` |

### 2.2 `tests/unit/scraper.test.ts` — content-type hardening (extended, 14 tests)

```bash
pnpm vitest run tests/unit/scraper.test.ts
```

Expected: `Tests 14 passed`. New cases:

| Test | Expected behaviour |
|------|--------------------|
| JSON content type | `InvalidContentTypeError` |
| PDF content type | `InvalidContentTypeError` |
| missing content-type header | `InvalidContentTypeError` |
| `text/html; charset=UTF-8` | accepted, title extracted |
| declared `content-length` > 5 MiB | `ExternalApiError` "Response too large" |
| decoded body > 5 MiB | `ExternalApiError` "Decoded response too large" |

### 2.3 `tests/unit/chunker.test.ts` — `chunkParentChild` (extended, 13 tests)

```bash
pnpm vitest run tests/unit/chunker.test.ts
```

Expected: `Tests 13 passed`. New cases:

| Test | Expected behaviour |
|------|--------------------|
| empty input | `[]` |
| parent cap | each parent ≤ 2000 + 200 chars |
| child cap | each child ≤ 200 + 50 chars |
| parent overlap | adjacent parents share the previous tail |
| short parent | a parent below child threshold becomes its own child |
| determinism | two runs identical |
| content preservation | joined parents ≥ 90% of source length |

### 2.4 `tests/unit/ingest-pipeline.test.ts` — `pdfSourceKey` (extended, 13 tests)

```bash
pnpm vitest run tests/unit/ingest-pipeline.test.ts
```

Expected: `Tests 13 passed`. New cases:

| Test | Expected behaviour |
|------|--------------------|
| deterministic | same buffer + filename → same key |
| buffer-sensitive | different buffers → different keys |
| filename case | `VISA-GUIDE.PDF` ≡ `visa-guide.pdf` |
| sanitization | `my file (final) v2.pdf` → `my_file_final_v2.pdf` |
| shape | matches `pdf://<16-hex>/<name>` |

### 2.5 `tests/unit/expand-to-parents.test.ts` (5 tests)

```bash
pnpm vitest run tests/unit/expand-to-parents.test.ts
```

Expected: `Tests 5 passed` (Prisma mocked). Cases:

| Test | Expected behaviour |
|------|--------------------|
| flat pass-through | no `parentId` → returned unchanged, no DB call |
| parent expansion | child text replaced by parent text, `childText` preserved |
| dedupe | two children sharing a parent → one expanded chunk |
| missing parent | child whose parent row is absent passes through |
| order preservation | flat + nested chunks keep input order |

### 2.6 `tests/unit/admin-test-pipeline.test.ts` (7 tests)

```bash
pnpm vitest run tests/unit/admin-test-pipeline.test.ts
```

Expected: `Tests 7 passed` (orchestrator + Prisma mocked). Cases:

| Test | Expected behaviour |
|------|--------------------|
| ADMIN gate | USER role rejected, orchestrator not called |
| min-length | `prompt` < 5 chars rejected by zod |
| full trace | returns `AgenticRagResponse` with child/parent snippets + guardrail |
| no-memory-write | `conversationMemory.upsert` / `conversation.create` / `message.create` never called |
| guardrail-blocked | propagates `guardrail.passed: false`, empty sources |
| cache-hit | single `Semantic Cache Hit` research step |
| bypass-cache | orchestrator called with `{ bypassCache: true, memory: NoopMemory }` |

---

## 3. E2E specs (deferred to a machine with a DB)

The specs compile and list here. Running them requires a live dev server (`pnpm dev --port 3000`) backed by a real Postgres + pgvector DB, and the ADMIN session helper needs `NEXTAUTH_SECRET` (already defaulted in `playwright.config.ts`). Playwright browsers must be installed once:

```bash
pnpm exec playwright install chromium
```

### 3.1 Compile check (works without a DB)

```bash
pnpm exec playwright test --list
```

Expected: `Total: 21 tests in 6 files`, including:

```
[chromium] › documents-upload.spec.ts:49:5 › ingests a valid text PDF successfully
[chromium] › documents-upload.spec.ts:73:5 › rejects an oversized PDF on the server with 413
[chromium] › documents-upload.spec.ts:95:5 › rejects a scanned/image-only PDF with 422
[chromium] › documents-upload.spec.ts:114:5 › rejects an oversized file client-side before uploading
[chromium] › pipeline-tester.spec.ts:53:5 › renders all four stages after running a trace
[chromium] › pipeline-tester.spec.ts:74:5 › shows the child snippet and expanded parent context
[chromium] › pipeline-tester.spec.ts:86:5 › surfaces an out-of-domain guardrail block
[chromium] › pipeline-tester.spec.ts:133:5 › marks a cache-hit trace with a badge
[chromium] › pipeline-tester.spec.ts:172:5 › shows the empty state before the first run
```

### 3.2 Run

```bash
pnpm test:e2e
```

Expected: `21 passed` across `pipeline-tester.spec.ts` (5) and `documents-upload.spec.ts` (4) plus the existing 12 admin/chat/history/landing tests.

The pipeline-tester specs mock the `admin.testPipeline` tRPC procedure (via `tests/e2e/helpers/trpc-mock.ts`) so they pass without LLM keys. The upload specs mock the `/api/admin/documents/upload` route, so they exercise the UI + client validation without a real embedding call.

---

## 4. Fixtures

| File | Purpose | Verified through `parsePdf` |
|------|---------|------------------------------|
| `tests/e2e/fixtures/valid-guide.pdf` | 1-page text PDF, 732 B | returns `pages: 1`, extracts text |
| `tests/e2e/fixtures/image-only.pdf` | 1-page PDF with no text | throws "PDF contains no extractable text (scanned/image-only?)" |

The fixtures are hand-generated with byte-accurate xref offsets. Regenerate them only via the generator snippets in the Phase-4 commit history; do not edit by hand.

---

## 5. Manual verification of the PDF upload route (optional, needs DB + HF token)

With a running dev server, upload `tests/e2e/fixtures/valid-guide.pdf` through `/admin/documents`. Expected flow:

1. Dropzone accepts the `.pdf`.
2. `POST /api/admin/documents/upload` returns `200` with `{ status: "created", chunkCount: N, parentCount: M, filename: "valid-guide.pdf" }`.
3. UI shows `Ingested valid-guide.pdf → created (N child chunks)`.
4. Uploading `image-only.pdf` returns `422` with the "no extractable text" message.
5. Uploading a >4 MB PDF is rejected client-side before any request.

---

## 6. Notes / gotchas

- **Env injection** — without `.env`, `pnpm test` and `pnpm build` fail with "Invalid server environment variables: DATABASE_URL, NEXTAUTH_SECRET". Prefix the commands as in §0.
- **`import.meta` is unavailable** in Playwright specs — `documents-upload.spec.ts` resolves fixtures from `process.cwd()`, so always run e2e from `web-app/`.
- **E2E mocks are API-level** — the tRPC and upload-route mocks make the specs hermetic and LLM/embedding-free, which is why they can run in CI without HF/Groq credentials.
