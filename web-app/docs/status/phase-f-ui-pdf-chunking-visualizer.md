# Phase F — Global UI Overhaul, URL Validation Hardening, PDF Ingestion, Parent-Child Chunking & Pipeline Visualizer

**Status:** COMPLETE (Phases 0–4 all done)
**Date:** 2026-08-01 (updated 2026-08-02)
**Branch:** `web-app`
**Scope:** IMPLEMENTATION_PLAN.md Phases 0–4 (approved plan)

## Summary

The approved phase-D/E follow-up plan is being executed in four phases. Phase 0 (URL content-type validation hardening), Phase 1 (parent-child chunking + PDF ingestion), Phase 2 (dual-palette UI overhaul), Phase 3 (pipeline visualizer), and Phase 4 (tests & CI hardening) are all implemented and verified: typecheck clean, lint clean, build clean, and the full unit/integration/component suite is green (41 files / 280 tests). Phase 4 adds unit tests for the PDF parser, scraper content-type guard, parent-child chunker, `pdfSourceKey`, `expandToParents`, and `admin.testPipeline` (no-memory-write), plus e2e specs for the pipeline tester and PDF upload (413/422/client-side rejection), verified end-to-end except browser execution which requires a live DB + LLM keys.

## Phase Status

| Phase | Scope | Status |
|-------|-------|--------|
| Phase 0 | URL content-type validation, new domain errors, tRPC error plumbing | DONE (verified) |
| Phase 1 | Parent-child chunking + PDF ingestion (schema, chunker, parser, pipeline, upload route, dropzone) | DONE (migration unverified — no DB in sandbox) |
| Phase 2 | Two distinct light/dark palettes, glassmorphism, animated mesh, landing content, edge-case states | DONE (verified) |
| Phase 3 | `admin.testPipeline` tRPC endpoint, trace enrichment, pipeline visualizer page + stage components, nav entry | DONE (verified) |
| Phase 4 | Unit tests (pdf-parser, scraper content-type, chunkParentChild, pdfSourceKey, expandToParents, testPipeline), e2e (pipeline tester + PDF upload), full gates | DONE (e2e execution deferred to machine with DB) |

## Deliverables (Phase 0, 1 & 2)

| Area | Deliverable |
|------|-------------|
| Error plumbing | `INVALID_CONTENT_TYPE` (415) + `PDF_PARSE_FAILED` (422) codes in `src/server/lib/errors/codes.ts`; `InvalidContentTypeError` + `PdfParseError` in `src/server/lib/errors/domain-error.ts` |
| SSRF / content guards | `src/server/ingest/scraper.ts`: strict MIME allowlist (`text/html`, `text/plain`), `Content-Length` + decoded-byte caps, post-redirect `assertSafeUrl` |
| Schema | `DocumentParentChunk` model + nullable `DocumentChunk.parentId` in `prisma/schema.prisma`; `prisma validate`/`generate` pass; handwritten migration `prisma/migrations/20260801_add_parent_child_chunks/migration.sql` (unverified against real pgvector DB) |
| Chunking | `chunkParentChild()` in `src/server/ingest/chunker.ts` (2000-char parents, 200-char children, 200/50 overlap); `Chunk.childText?`/`parentId?` |
| Retrieval | `expandToParents()` in `src/server/rag/retrieval/join.ts` (dedupes by `parentId`, preserves best child score); wired into `hybrid.ts` post-rerank; `parentId` selected in `dense.ts`/`corpus.ts`; CRAG gate still uses child `crossScore` |
| PDF parser | `src/server/ingest/pdf-parser.ts` (imports `pdf-parse/lib/pdf-parse.js`, `MAX_PDF_PAGES=200`, guards); `src/types/pdf-parse.d.ts` local submodule type declaration |
| Pipeline | `src/server/ingest/pipeline.ts`: `persistIngested()`, `ingestPdf()`, `pdfSourceKey()` = `pdf://<sha256-prefix16>/<sanitized-name>`, `storeDocument()` v2 (transactional parent + child inserts, legacy-parent cleanup, count updates, embedding invalidation) |
| Upload route | `src/app/api/admin/documents/upload/route.ts`: ADMIN gate (403), 4 MiB cap (413), MIME/empty checks (415/400), parse failure (422), `maxDuration=60` |
| Dropzone | `src/components/admin/document-manager.tsx`: rewritten dropzone with 4 MB client mirror + typed error feedback |
| Dual palettes | `src/app/globals.css`: warm "Paper & Ink" light theme + deep "Midnight" dark theme (fully distinct token values), `.glass-card`, animated `.gradient-mesh` via `--color-mesh-a/b/c`, `@supports not (backdrop-filter)` fallback, `prefers-reduced-motion` guard killing mesh/shimmer/pulse |
| UI primitives | `src/components/ui/`: `glass-card.tsx`, `skeleton.tsx` (aria `status`), `empty-state.tsx`, `error-state.tsx` (typed `code` + retry), `theme-toggle.tsx` (light/dark/system, compact mode) |
| Landing page | `src/app/page.tsx`: hero + features restyled as glass cards, 4 new `CONTENT_SECTIONS` (Guides / Universities / Finances / Timelines) with eyebrow + CTA |
| Wiring | `app-sidebar.tsx` (compact ThemeToggle footer, `text-primary-foreground`), `settings/page.tsx` (Appearance section), `admin/layout.tsx` (mesh accent + focus-visible), `source-browser.tsx` (Skeleton/EmptyState) |

## Deliverables (Phase 3)

| Area | Deliverable |
|------|-------------|
| Trace enrichment | `AgenticRagResponse` gains `maskedQuery` + `guardrail` (`orchestrator.ts`), populated at cache-hit / guardrail-blocked / success return sites via `withStageZero()`; `MemoryLike` structural interface |
| Router | `admin.testPipeline` (`admin.ts`): `z.string().trim().min(5).max(2000)`, `runAgenticRag` with `bypassCache: true` + `NoopMemory`; logs latency |
| Timeout guard | `adminLongProcedure` (`t.ts`): `isAuthenticated` + `isAdmin` + 60 s `withTimeout` middleware; client mutation uses `retry: false` |
| Duration | `runtime = "nodejs"` + `maxDuration = 60` on the tRPC route handler |
| Source enrichment | `Source` gains optional `childText` + `parentText` (`rag/types.ts`); `research.ts` populates both from the parent-expanded chunk |
| Visualizer | `src/components/admin/pipeline/`: `stage-node.tsx` (GitHub-Actions-style timeline node with done/warning/skipped/running states), `react-step.tsx` (thought/action/observation per ReAct iteration), `source-panel.tsx` (collapsible matched-child snippet + expanded-parent context), `pipeline-visualizer.tsx` (4-stage trace with guardrail/cache badges) |
| Page | `src/app/admin/pipeline-tester/page.tsx`: query input, example chips, running state, typed `ErrorState`, `EmptyState` before first run, `PipelineVisualizer` on success |
| Nav | "Pipeline tester" entry added to `NAV_ITEMS` in `src/app/admin/layout.tsx` |

## Quality Gates (as of 2026-08-02)

| Gate | Command | Result |
|------|---------|--------|
| Typecheck | `pnpm typecheck` | PASS |
| Lint | `pnpm lint` | PASS (0 errors; pre-existing `.lintstagedrc.mjs` warning only) |
| Build | `pnpm build` (with dummy `DATABASE_URL` + `NEXTAUTH_SECRET`) | PASS (`/admin/pipeline-tester` generated) |
| Unit + integration + component tests | `pnpm test` (with dummy `DATABASE_URL` + `NEXTAUTH_SECRET`) | PASS (280 tests, 41 files) |
| E2E spec compile | `pnpm exec playwright test --list` | PASS (21 tests, 6 files; browser execution deferred to machine with DB) |

## Deliverables (Phase 4)

| Area | Deliverable |
|------|-------------|
| pdf-parser tests | `tests/unit/pdf-parser.test.ts` — valid PDF, empty buffer, image-only (no text), >200 pages, parse throw; `MAX_PDF_BYTES`/`MAX_PDF_PAGES`/`ACCEPTED_MIME` constants |
| scraper content-type tests | `tests/unit/scraper.test.ts` — JSON/PDF/missing content-type rejection, charset acceptance, Content-Length cap, decoded-body cap |
| chunker tests | `tests/unit/chunker.test.ts` — `chunkParentChild` empty, parent cap, child cap, parent overlap, short-parent-as-own-child, determinism, content preservation |
| pdfSourceKey tests | `tests/unit/ingest-pipeline.test.ts` — determinism, buffer sensitivity, case-insensitive filename, sanitization, `pdf://<16-hex>/<name>` shape |
| expandToParents tests | `tests/unit/expand-to-parents.test.ts` — flat pass-through, parent expansion, parentId dedupe, missing parent, mixed order preservation (mocked Prisma) |
| testPipeline tests | `tests/unit/admin-test-pipeline.test.ts` — ADMIN gate, min-length validation, full trace with child/parent snippets, no ConversationMemory/message/conversation writes, guardrail-blocked + cache-hit responses (mocked orchestrator) |
| E2E pipeline tester | `tests/e2e/pipeline-tester.spec.ts` — 4 stages render, child→parent expansion, guardrail BLOCKED short-circuit, cache-hit badge, pre-run empty state |
| E2E PDF upload | `tests/e2e/documents-upload.spec.ts` — valid PDF → created, server 413, image-only 422, client-side >4 MB rejection (mocked upload route) |
| Fixtures | `tests/e2e/fixtures/valid-guide.pdf` (1-page text PDF) + `image-only.pdf` (no text) — generated with byte-accurate xrefs, verified through `parsePdf` |
| Verification doc | `docs/TESTING_PHASE4.md` — commands + expected outputs for every test area |

## Decisions & Exceptions

- **4 MiB / 4 MB cap everywhere** — Vercel rejects bodies > 4.5 MB before the handler runs; a single number server-side (4,194,304 B) and client-side (4 MB).
- **ADMIN-only PDF ingestion** — the upload route gates on `session.user.role === "ADMIN"` (403 otherwise) because ingestion mutates the shared knowledge base.
- **True parent-child chunking** — children (~200 ch) embedded and searched; on match the parent (~2000 ch) is handed to the LLM. `chunkCount` = child count; `parentCount` exposed in `IngestResult`.
- **Local submodule typings** — `@types/pdf-parse` only covers the package root, so `src/types/pdf-parse.d.ts` declares `pdf-parse/lib/pdf-parse.js`; explicit cast on `mod.default` unifies the options-param type.
- **`parentId` nullable** — legacy flat chunks stay valid; backfill path is `pnpm ingest --sync --force`.
- **Two independent palettes** — light "Paper & Ink" and dark "Midnight" share token names but not values; mesh hues drift per theme (`--color-mesh-a/b/c`); motion killed under `prefers-reduced-motion`.
- **Orchestrator trace enrichment** — `AgenticRagResponse` gains `maskedQuery` + `guardrail` (populated at cache-hit / guardrail-blocked / success return sites via `withStageZero` helper); orchestrator memory type loosened to structural `MemoryLike` so `NoopMemory` can be injected.
- **`NoopMemory`** — explicit side-effect-free memory so `admin.testPipeline` never writes a ConversationMemory row with a dangling FK.
- **`maxDuration = 60`** on the tRPC route handler (pipeline tests issue 3–5 sequential LLM calls).
- **No DB in sandbox** — `docker`/`psql`/port 5432 unavailable; the handwritten migration is unverified against pgvector. Test env is injected on the command line because `.env` is absent.

## Known Issues / Blockers

- **Migration not applied** to a real database (`pnpm prisma migrate dev --name parent_child_chunks` + `pnpm ingest --sync --force` backfill pending DB availability).
- **Tests require env vars** — `tests/setup.ts` loads `.env` (absent); full suite needs `DATABASE_URL` + `NEXTAUTH_SECRET` injected. CI workflow should supply these.

## Next Steps

- [x] Phase 4: unit tests (`pdf-parser`, `scraper` content-type, `chunkParentChild`, `pdfSourceKey`, `expandToParents`, `testPipeline` no-memory-write), e2e (pipeline tester + PDF upload), full `lint/typecheck/test` run.
- [ ] Apply migration to real DB when available (`pnpm prisma migrate dev --name parent_child_chunks`) and run `pnpm ingest --sync --force` backfill.
- [ ] Run `pnpm test:e2e` on a machine with a DB + LLM keys; verify the 21 e2e specs pass against the live dev server.
- [ ] Verify a real pipeline run in the browser renders Stage 0 (masked query + guardrail), Stage 1 (ReAct steps + child snippet + expanded parent), Stage 2 (matrix), Stage 3 (markdown answer) — requires a live DB + LLM keys.
